// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminPassword,
  isUsingDefaultPassword,
  setAdminPassword,
} from '../../functions/modules/utils.js';
import { handleLogin, verifySignedToken } from '../../functions/modules/auth-middleware.js';
import { COOKIE_NAME } from '../../functions/modules/config.js';

const COOKIE_SECRET = 'test-cookie-signing-secret';
const KV_PASSWORD = 'test-kv-admin-password';

function createKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get: vi.fn(async (key) => values.get(key) ?? null),
    put: vi.fn(async (key, value) => values.set(key, value)),
  };
}

function loginRequest(password) {
  return new Request('https://example.com/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
}

async function expectSignedLogin(response) {
  expect(response.status).toBe(200);
  const cookie = response.headers.get('Set-Cookie');
  expect(cookie).toMatch(new RegExp(`^${COOKIE_NAME}=`));
  const token = cookie.split(';')[0].slice(COOKIE_NAME.length + 1);
  expect(await verifySignedToken(COOKIE_SECRET, token)).toMatch(/^\d+$/);
  return response.json();
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('administrator password storage failures', () => {
  it.each([
    'KV storage is paused',
    'namespace is paused',
    'KV put() limit exceeded for the day.',
    'KV get() limit exceeded for the day.',
    'KV request timed out',
  ])('rejects password reads and default-password login when %s', async (message) => {
    const failure = new Error(message);
    const kv = createKv({ SYSTEM_ADMIN_PASSWORD: KV_PASSWORD });
    kv.get.mockRejectedValue(failure);
    kv.put.mockRejectedValue(failure);
    const env = { MISUB_KV: kv, COOKIE_SECRET };

    await expect(getAdminPassword(env)).rejects.toBe(failure);
    await expect(isUsingDefaultPassword(env)).rejects.toBe(failure);
    const response = await handleLogin(loginRequest('admin'), env);
    expect(response.status).toBe(500);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.json()).toEqual({ error: '登录处理失败' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('rejects login when only the stored administrator password is unreadable', async () => {
    const kv = createKv({ SYSTEM_COOKIE_SECRET: COOKIE_SECRET });
    kv.get.mockImplementation(async (key) => {
      if (key === 'SYSTEM_ADMIN_PASSWORD') throw new Error('KV storage is paused');
      return key === 'SYSTEM_COOKIE_SECRET' ? COOKIE_SECRET : null;
    });

    const response = await handleLogin(loginRequest('admin'), { MISUB_KV: kv });
    expect(response.status).toBe(500);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.json()).toEqual({ error: '登录处理失败' });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('uses an environment password while KV is paused', async () => {
    const kv = createKv();
    kv.get.mockRejectedValue(new Error('KV storage is paused'));
    kv.put.mockRejectedValue(new Error('KV storage is paused'));
    const env = { MISUB_KV: kv, ADMIN_PASSWORD: '  test-env-password  ', COOKIE_SECRET };

    await expect(getAdminPassword(env)).resolves.toBe('test-env-password');
    expect(kv.get).not.toHaveBeenCalled();
    const body = await expectSignedLogin(await handleLogin(loginRequest('test-env-password'), env));
    expect(body).toEqual({ success: true });
    const denied = await handleLogin(loginRequest('admin'), env);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('Set-Cookie')).toBeNull();
  });

  it('keeps the stored password effective and rejects the default password', async () => {
    const kv = createKv({
      SYSTEM_ADMIN_PASSWORD: `  ${KV_PASSWORD}  `,
      SYSTEM_COOKIE_SECRET: COOKIE_SECRET,
    });
    const env = { MISUB_KV: kv };

    await expect(getAdminPassword(env)).resolves.toBe(KV_PASSWORD);
    expect(await expectSignedLogin(await handleLogin(loginRequest(KV_PASSWORD), env))).toEqual({
      success: true,
    });
    const denied = await handleLogin(loginRequest('admin'), env);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('Set-Cookie')).toBeNull();
  });

  it.each(['missing password key', 'no KV binding'])(
    'preserves default-password initialization with %s',
    async (mode) => {
      const env = { COOKIE_SECRET };
      if (mode === 'missing password key') env.MISUB_KV = createKv();

      await expect(getAdminPassword(env)).resolves.toBe('admin');
      const body = await expectSignedLogin(await handleLogin(loginRequest('admin'), env));
      expect(body).toMatchObject({
        success: true,
        securityWarning: { type: 'default_admin_password', shouldChangePassword: true },
      });
    }
  );
});

describe('administrator password changes', () => {
  it('rejects a KV password change when ADMIN_PASSWORD controls the deployment', async () => {
    const kv = createKv({ SYSTEM_ADMIN_PASSWORD: KV_PASSWORD });

    await expect(
      setAdminPassword({ MISUB_KV: kv, ADMIN_PASSWORD: 'test-env-password' }, 'replacement')
    ).rejects.toThrow('环境变量 ADMIN_PASSWORD');
    expect(kv.put).not.toHaveBeenCalled();
    expect(await kv.get('SYSTEM_ADMIN_PASSWORD')).toBe(KV_PASSWORD);
  });

  it('persists password changes when the deployment uses KV', async () => {
    const kv = createKv({ SYSTEM_ADMIN_PASSWORD: KV_PASSWORD });
    const env = { MISUB_KV: kv, ADMIN_PASSWORD: '  ' };

    await setAdminPassword(env, 'replacement');
    await expect(getAdminPassword(env)).resolves.toBe('replacement');
  });

  it('rejects password changes without a KV binding', async () => {
    await expect(setAdminPassword({}, 'replacement')).rejects.toThrow('未绑定 KV');
  });
});
