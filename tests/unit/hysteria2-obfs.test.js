import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { fixNodeUrlEncoding } from '../../functions/utils/node-utils.js';
import { urlToClashProxy } from '../../functions/utils/url-to-clash.js';
import { extractValidNodes, parseNodeList } from '../../functions/modules/utils/node-parser.js';
import { generateCombinedNodeList } from '../../functions/services/subscription-service.js';
import { transformBuiltinSubscription } from '../../functions/modules/subscription/transformer-factory.js';
import {
    renderClashFromIniTemplate, renderSingboxFromIniTemplate,
    renderSurgeFromIniTemplate, renderLoonFromIniTemplate, renderEgernFromIniTemplate
} from '../../functions/modules/subscription/template-pipeline.js';
import { parseSurgeConfig } from '../../src/utils/protocols/surge-parser.js';
import { parseLoonConfig } from '../../src/utils/protocols/loon-parser.js';

const template = '[Proxy Group]\nProxy = select, HY2, DIRECT\n[Rule]\nMATCH,Proxy';
const specialPasswords = ['plain-secret', 'has+plus', 'has#hash', 'literal%2B', 'has space', 'has&and=equals', 'has,comma', 'has"quote\\slash'];
const obfsPassword = 'obfs+test#literal%2B,with="quote"\\slash';
const authPassword = 'auth+test#literal%2B,with="quote"\\slash';

function nodeUrl(scheme = 'hy2', password = obfsPassword, auth = authPassword) {
    return `${scheme}://${encodeURIComponent(auth)}@example.com:443?obfs=salamander&obfs-password=${encodeURIComponent(password)}&sni=edge.example.com#HY2`;
}

function expectProxy(proxy, password = obfsPassword, auth = authPassword) {
    expect(proxy).toMatchObject({
        type: 'hysteria2', server: 'example.com', port: 443,
        password: auth, obfs: 'salamander', 'obfs-password': password, sni: 'edge.example.com'
    });
}

describe('Hysteria2 obfuscation preservation', () => {
    afterEach(() => vi.unstubAllGlobals());

    describe.each(['hy2', 'hysteria2'])('%s URL processing', scheme => {
        it.each(specialPasswords)('preserves password %s through repeated normalization and preview', password => {
            const original = nodeUrl(scheme, password, password);
            const fixed = fixNodeUrlEncoding(original, { plusAsSpace: true });
            expect(fixNodeUrlEncoding(fixed, { plusAsSpace: true })).toBe(fixed);
            expectProxy(urlToClashProxy(fixed), password, password);
            expectProxy(urlToClashProxy(parseNodeList(original)[0].url), password, password);
        });
    });

    it('normalizes only the fragment and leaves parameter encoding intact', () => {
        const original = nodeUrl().replace('#HY2', '#Hong+Kong');
        const fixed = fixNodeUrlEncoding(original, { plusAsSpace: true });
        expect(fixed.slice(0, fixed.indexOf('#'))).toBe(original.slice(0, original.indexOf('#')));
        expect(decodeURIComponent(fixed.split('#')[1])).toBe('Hong Kong');
    });

    it('preserves an obfs-password field even when obfs is absent', () => {
        const parsed = urlToClashProxy(nodeUrl().replace('obfs=salamander&', ''));
        expect(parsed['obfs-password']).toBe(obfsPassword);
        expect(parsed.obfs).toBeUndefined();
    });

    it('preserves Clash YAML through URL, preview, and generated Clash output', () => {
        const source = yaml.dump({ proxies: [{
            name: 'HY2', type: 'hysteria2', server: 'example.com', port: 443,
            password: authPassword, sni: 'edge.example.com', obfs: 'salamander', 'obfs-password': obfsPassword
        }] });
        const nodes = parseNodeList(source).map(node => node.url).join('\n');
        expectProxy(urlToClashProxy(nodes));
        expectProxy(yaml.load(transformBuiltinSubscription(nodes, 'clash', { addFlagEmoji: false })).proxies[0]);
        expectProxy(yaml.load(renderClashFromIniTemplate(template, { nodeList: nodes })).proxies[0]);
    });

    it.each(['manual', 'remote'])('preserves credentials through %s subscription aggregation', async source => {
        const original = nodeUrl();
        vi.stubGlobal('fetch', vi.fn(async () => new Response(original)));
        const combined = await generateCombinedNodeList({}, { enableAccessLog: false }, 'ClashMeta', [{
            id: 'hy2-obfs-test', name: 'HY2', enabled: true,
            url: source === 'manual' ? original : 'https://subscription.example.com/nodes'
        }], '', { enableManualNodes: true, enableSubscriptions: true });
        expectProxy(urlToClashProxy(combined.trim()));
        const outbound = JSON.parse(transformBuiltinSubscription(combined, 'singbox')).outbounds.find(p => p.type === 'hysteria2');
        expect(outbound.obfs).toEqual({ type: 'salamander', password: obfsPassword });
    });

    it.each([
        ['Surge compatible', `HY2 = hysteria2, example.com, 443, password=${JSON.stringify(authPassword)}, obfs=salamander, obfs-password=${JSON.stringify(obfsPassword)}, sni=edge.example.com`],
        ['Surge native', `HY2 = hysteria2, example.com, 443, password=${JSON.stringify(authPassword)}, salamander-password=${JSON.stringify(obfsPassword)}, sni=edge.example.com`],
        ['Loon native', `HY2 = hysteria2, example.com, 443, ${JSON.stringify(authPassword)}, salamander-password=${JSON.stringify(obfsPassword)}, sni=edge.example.com`],
        ['QX compatible', `hysteria2=example.com:443, password=${JSON.stringify(authPassword)}, obfs=salamander, obfs-password=${JSON.stringify(obfsPassword)}, sni=edge.example.com, tag=HY2`]
    ])('preserves obfs fields from %s INI imports', (_label, source) => {
        const nodes = extractValidNodes(source);
        expect(nodes).toHaveLength(1);
        expectProxy(urlToClashProxy(nodes[0]));
    });

    it.each([
        ['builtin', nodeList => transformBuiltinSubscription(nodeList, 'singbox')],
        ['template', nodeList => renderSingboxFromIniTemplate(template, { nodeList })]
    ])('writes native sing-box obfs in the %s generator', (_label, generate) => {
        const outbound = JSON.parse(generate(nodeUrl())).outbounds.find(p => p.type === 'hysteria2');
        expect(outbound).toMatchObject({ password: authPassword, tls: { server_name: 'edge.example.com' } });
        expect(outbound.obfs).toEqual({ type: 'salamander', password: obfsPassword });
        expect(outbound).not.toHaveProperty('obfs-password');
        const plain = JSON.parse(generate('hy2://plain@example.com:443#HY2')).outbounds.find(p => p.type === 'hysteria2');
        expect(plain).not.toHaveProperty('obfs');
    });

    it.each([
        ['builtin', nodeList => transformBuiltinSubscription(nodeList, 'egern')],
        ['template', nodeList => renderEgernFromIniTemplate(template, { nodeList })]
    ])('writes native Egern obfs in the %s generator', (_label, generate) => {
        const proxy = yaml.load(generate(nodeUrl())).proxies.find(p => p.hysteria2).hysteria2;
        expect(proxy).toMatchObject({ auth: authPassword, obfs: 'salamander', obfs_password: obfsPassword });
    });

    it.each([
        ['builtin Surge', nodeList => transformBuiltinSubscription(nodeList, 'surge'), parseSurgeConfig],
        ['template Surge', nodeList => renderSurgeFromIniTemplate(template, { nodeList }), parseSurgeConfig],
        ['builtin Loon', nodeList => transformBuiltinSubscription(nodeList, 'loon'), parseLoonConfig],
        ['template Loon', nodeList => renderLoonFromIniTemplate(template, { nodeList }), parseLoonConfig]
    ])('preserves credentials through %s output and both import paths', (_label, generate, parse) => {
        const output = generate(nodeUrl());
        expect(output).toContain('salamander-password=');
        const line = output.split('\n').find(line => line.includes(' = hysteria2,'));
        expectProxy(urlToClashProxy(extractValidNodes(line)[0]));
        expectProxy(urlToClashProxy(parse(line)[0].url));
    });

    it.each([parseSurgeConfig, parseLoonConfig])('preserves compatible obfs fields in the frontend parser', parse => {
        const auth = parse === parseSurgeConfig ? `password=${JSON.stringify(authPassword)}` : JSON.stringify(authPassword);
        const source = `HY2 = hysteria2, example.com, 443, ${auth}, obfs=salamander, obfs-password=${JSON.stringify(obfsPassword)}, sni=edge.example.com`;
        expectProxy(urlToClashProxy(parse(source)[0].url));
    });

    it('keeps apostrophes in unquoted INI passwords literal', () => {
        const source = "HY2 = hysteria2, example.com, 443, password=don't-change, salamander-password=don't-change, sni=edge.example.com";
        expectProxy(urlToClashProxy(extractValidNodes(source)[0]), "don't-change", "don't-change");
        expectProxy(urlToClashProxy(parseSurgeConfig(source)[0].url), "don't-change", "don't-change");
    });
});
