// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateBuiltinSingboxConfig } from '../../functions/modules/subscription/builtin-singbox-generator.js';
import { renderSingboxFromTemplateModel } from '../../functions/modules/subscription/template-renderers/render-singbox.js';
import { renderSingboxFromIniTemplate } from '../../functions/modules/subscription/template-pipeline.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '[Proxy Group]\nProxy = select, VMess, DIRECT\n[Rule]\nMATCH,Proxy\n';
const BASE_PROXY = {
  name: 'VMess',
  type: 'vmess',
  server: 'edge.example.com',
  port: 443,
  uuid: UUID,
  cipher: 'aes-128-gcm',
  alterId: 16,
};

function vmessUrl(proxy) {
  const network = proxy.network || 'tcp';
  const options = proxy[`${network}-opts`] || {};
  const host =
    network === 'ws'
      ? options.headers?.Host
      : network === 'grpc'
        ? options['grpc-service-name']
        : Array.isArray(options.host || options.headers?.Host)
          ? (options.host || options.headers.Host).join(',')
          : options.host || options.headers?.Host;
  return `vmess://${Buffer.from(
    JSON.stringify({
      v: '2',
      ps: proxy.name,
      add: proxy.server,
      port: String(proxy.port),
      id: proxy.uuid,
      aid: String(proxy.alterId),
      scy: proxy.cipher,
      net: network,
      host: host || '',
      path: options.path || '',
      tls: proxy.tls ? 'tls' : '',
      sni: proxy.servername || '',
      alpn: proxy.alpn?.join(',') || '',
    })
  ).toString('base64')}`;
}

const RENDERERS = [
  [
    'builtin',
    (proxy) =>
      JSON.parse(
        generateBuiltinSingboxConfig(
          proxy.type === 'vmess'
            ? vmessUrl(proxy)
            : `tuic://${UUID}:test-password@edge.example.com:443?congestion_control=bbr&udp_relay_mode=quic&alpn=h3#TUIC`,
          { skipCertVerify: proxy['skip-cert-verify'] === true }
        )
      ),
  ],
  [
    'template model',
    (proxy) => JSON.parse(renderSingboxFromTemplateModel({ proxies: [{ ...proxy }] })),
  ],
  [
    'INI pipeline',
    (proxy) => JSON.parse(renderSingboxFromIniTemplate(TEMPLATE, { proxies: [{ ...proxy }] })),
  ],
];

describe.each(RENDERERS)('sing-box VMess schema through %s', (_name, render) => {
  it.each([
    ['plain TCP', {}, undefined],
    [
      'WebSocket',
      { network: 'ws', 'ws-opts': { path: '/vmess', headers: { Host: 'ws.example.com' } } },
      { type: 'ws', path: '/vmess', headers: { Host: 'ws.example.com' } },
    ],
    [
      'gRPC',
      { network: 'grpc', 'grpc-opts': { 'grpc-service-name': 'vmess-service' } },
      { type: 'grpc', service_name: 'vmess-service' },
    ],
    [
      'HTTP/2',
      { network: 'h2', 'h2-opts': { path: '/h2', host: ['h2.example.com', 'backup.example.com'] } },
      { type: 'http', path: '/h2', host: ['h2.example.com', 'backup.example.com'] },
    ],
    [
      'HTTP host headers',
      { network: 'http', 'http-opts': { path: '/http', headers: { Host: ['http.example.com'] } } },
      { type: 'http', path: '/http', host: ['http.example.com'] },
    ],
  ])(
    'uses valid fields for %s while preserving TLS and transport',
    (_label, network, transport) => {
      const proxy = {
        ...BASE_PROXY,
        ...network,
        tls: true,
        servername: 'tls.example.com',
        alpn: ['h2', 'http/1.1'],
        'udp-relay-mode': 'quic',
        'congestion-control': 'bbr',
      };
      const vmess = render(proxy).outbounds.find((outbound) => outbound.type === 'vmess');
      expect(vmess).toMatchObject({
        type: 'vmess',
        server: proxy.server,
        server_port: 443,
        uuid: UUID,
        security: 'aes-128-gcm',
        alter_id: 16,
      });
      expect(vmess).not.toHaveProperty('udp_relay_mode');
      expect(vmess).not.toHaveProperty('congestion_control');
      expect(vmess.tls).toMatchObject({
        enabled: true,
        server_name: 'tls.example.com',
        alpn: ['h2', 'http/1.1'],
      });
      if (transport) expect(vmess.transport).toMatchObject(transport);
      else expect(vmess).not.toHaveProperty('transport');
    }
  );

  it('does not invent TLS, transport or TUIC defaults for a plain VMess node', () => {
    const vmess = render(BASE_PROXY).outbounds.find((outbound) => outbound.type === 'vmess');
    expect(vmess).not.toHaveProperty('tls');
    expect(vmess).not.toHaveProperty('transport');
    expect(vmess).not.toHaveProperty('udp_relay_mode');
    expect(vmess).not.toHaveProperty('congestion_control');
  });

  it('does not enable TLS just because certificate verification is disabled', () => {
    const vmess = render({ ...BASE_PROXY, 'skip-cert-verify': true }).outbounds.find(
      (outbound) => outbound.type === 'vmess'
    );
    expect(vmess).not.toHaveProperty('tls');
    expect(vmess).not.toHaveProperty('transport');
  });

  it('preserves certificate verification settings for an explicit TLS node', () => {
    const vmess = render({
      ...BASE_PROXY,
      tls: true,
      servername: 'tls.example.com',
      'skip-cert-verify': true,
    }).outbounds.find((outbound) => outbound.type === 'vmess');
    expect(vmess.tls).toMatchObject({
      enabled: true,
      server_name: 'tls.example.com',
      insecure: true,
    });
  });

  it('preserves UDP relay and congestion fields for TUIC', () => {
    const tuic = render({
      name: 'TUIC',
      type: 'tuic',
      server: 'edge.example.com',
      port: 443,
      uuid: UUID,
      password: 'test-password',
      alpn: ['h3'],
      'udp-relay-mode': 'quic',
      'congestion-control': 'bbr',
    }).outbounds.find((outbound) => outbound.type === 'tuic');
    expect(tuic).toMatchObject({ udp_relay_mode: 'quic', congestion_control: 'bbr' });
  });
});
