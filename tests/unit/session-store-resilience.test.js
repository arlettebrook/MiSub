import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionStore } from '../../src/stores/session.js';

const apiMocks = vi.hoisted(() => ({
    fetchInitialData: vi.fn(),
    fetchPublicConfig: vi.fn(),
    login: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const loaderMocks = vi.hoisted(() => ({ loadLegacyDashboard: vi.fn() }));
vi.mock('../../src/router/component-loaders.js', () => loaderMocks);

vi.mock('../../src/lib/api', () => apiMocks);
vi.mock('../../src/lib/http.js', () => ({
    api: { get: vi.fn() },
}));
vi.mock('../../src/router', () => ({
    default: routerMocks,
}));
vi.mock('../../src/utils/errorHandler.js', () => ({
    handleError: vi.fn(),
}));

describe('session store resilience', () => {
    beforeEach(() => {
        setActivePinia(createPinia());
        vi.clearAllMocks();
        localStorage.setItem('layoutMode', 'modern');
        loaderMocks.loadLegacyDashboard.mockReset().mockResolvedValue({});
        routerMocks.push.mockReset().mockResolvedValue(undefined);
    });

    it('falls back to the default login entry when public config cannot be fetched', async () => {
        const store = useSessionStore();

        apiMocks.fetchInitialData.mockResolvedValue({
            success: false,
            error: '认证失败,请重新登录',
            errorType: 'auth',
        });
        apiMocks.fetchPublicConfig.mockResolvedValue({
            success: false,
            error: 'HTTP 500',
            errorType: 'server',
        });

        await store.checkSession();

        expect(store.sessionState).toBe('loggedOut');
        expect(store.publicConfig.customLoginPath).toBe('login');
        expect(store.publicConfig.enablePublicPage).toBe(false);
    });

    it('does not let a failed public config request mask a successful authenticated session', async () => {
        const store = useSessionStore();

        const data = {
            config: { password: 'changed', isDefaultPassword: false },
            misubs: [],
            profiles: [],
        };

        apiMocks.fetchInitialData.mockResolvedValue({ success: true, data });
        apiMocks.fetchPublicConfig.mockResolvedValue({
            success: false,
            error: 'HTTP 500',
            errorType: 'server',
        });

        await store.checkSession();

        expect(store.sessionState).toBe('loggedIn');
        expect(store.initialData).toEqual(data);
        expect(store.publicConfig.customLoginPath).toBe('login');
    });

    it('keeps default-password warning from login response for immediate frontend display', async () => {
        const store = useSessionStore();

        apiMocks.login.mockResolvedValue({
            success: true,
            data: {
                securityWarning: {
                    type: 'default_admin_password',
                    shouldChangePassword: true,
                    message: '当前正在使用默认管理员密码 admin，请登录后立即修改。',
                },
            },
        });
        apiMocks.fetchInitialData.mockResolvedValue({
            success: true,
            data: { config: { isDefaultPassword: true }, misubs: [], profiles: [] },
        });
        apiMocks.fetchPublicConfig.mockResolvedValue({
            success: true,
            data: { customLoginPath: 'login' },
        });

        await store.login('admin');

        expect(store.securityWarning).toMatchObject({
            type: 'default_admin_password',
            shouldChangePassword: true,
        });
    });

    it('keeps the loading state until dashboard navigation and session data are both ready', async () => {
        const store = useSessionStore();
        let finishNavigation;
        routerMocks.push.mockReturnValue(
            new Promise((resolve) => {
                finishNavigation = resolve;
            })
        );
        apiMocks.login.mockResolvedValue({ success: true, data: {} });
        apiMocks.fetchInitialData.mockResolvedValue({
            success: true,
            data: { config: {}, misubs: [], profiles: [] },
        });
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });

        const login = store.login('password');
        await vi.waitFor(() => expect(apiMocks.fetchInitialData).toHaveBeenCalled());
        expect(apiMocks.fetchPublicConfig).toHaveBeenCalled();
        expect(routerMocks.push).toHaveBeenCalledWith({ path: '/dashboard' });
        expect(store.sessionState).toBe('loading');

        finishNavigation();
        await login;
        expect(store.sessionState).toBe('loggedIn');
    });

    it('exits the loading state if dashboard navigation fails after login', async () => {
        const store = useSessionStore();
        const error = new Error('Failed to load dashboard');
        routerMocks.push.mockRejectedValue(error);
        apiMocks.login.mockResolvedValue({ success: true, data: {} });
        apiMocks.fetchInitialData.mockResolvedValue({
            success: true,
            data: { config: {}, misubs: [], profiles: [] },
        });
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });

        await expect(store.login('password')).rejects.toBe(error);
        expect(store.sessionState).toBe('loggedOut');
    });

    it('prepares the legacy dashboard during login without revealing another loading screen', async () => {
        localStorage.setItem('layoutMode', 'legacy');
        let finishLegacy;
        loaderMocks.loadLegacyDashboard.mockReturnValue(
            new Promise((resolve) => {
                finishLegacy = resolve;
            })
        );
        apiMocks.login.mockResolvedValue({ success: true, data: {} });
        apiMocks.fetchInitialData.mockResolvedValue({
            success: true,
            data: { config: {}, misubs: [], profiles: [] },
        });
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });
        const store = useSessionStore();
        const login = store.login('password');
        await vi.waitFor(() => expect(loaderMocks.loadLegacyDashboard).toHaveBeenCalled());
        expect(store.sessionState).toBe('loading');
        finishLegacy({});
        await login;
        expect(store.sessionState).toBe('loggedIn');
    });

    it('does not clear an authenticated session when leaving the page cancels its requests', async () => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        apiMocks.fetchInitialData.mockResolvedValue({ success: false, cancelled: true });
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: false, cancelled: true });
        await store.checkSession();
        expect(store.sessionState).toBe('loggedIn');
    });
});
