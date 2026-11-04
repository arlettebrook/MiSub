import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSessionStore } from '../../src/stores/session.js';
import { useDataStore } from '../../src/stores/useDataStore.js';

const apiMocks = vi.hoisted(() => ({
    fetchInitialData: vi.fn(),
    fetchSessionStatus: vi.fn(),
    fetchPublicConfig: vi.fn(),
    login: vi.fn(),
    apiGet: vi.fn(),
    cancelPendingRequests: vi.fn(),
    cancelPrivateRequests: vi.fn(),
}));
const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const loaderMocks = vi.hoisted(() => ({ loadLegacyDashboard: vi.fn() }));
vi.mock('../../src/router/component-loaders.js', () => loaderMocks);

vi.mock('../../src/lib/api', () => apiMocks);
vi.mock('../../src/lib/http.js', () => ({
    api: { get: apiMocks.apiGet },
    cancelPendingRequests: apiMocks.cancelPendingRequests,
    cancelPrivateRequests: apiMocks.cancelPrivateRequests,
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
        apiMocks.apiGet.mockReset();
        apiMocks.fetchSessionStatus.mockReset().mockResolvedValue({ success: true });
        apiMocks.fetchPublicConfig.mockReset().mockResolvedValue({
            success: true,
            data: { enablePublicPage: true, hasCustomLoginPath: false, isLoginPath: false },
        });
        sessionStorage.clear();
        localStorage.setItem('layoutMode', 'modern');
        loaderMocks.loadLegacyDashboard.mockReset().mockResolvedValue({});
        routerMocks.push.mockReset().mockResolvedValue(undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    it('refreshes root disguise settings after logout without returning to the remembered admin entry', async () => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        store.loginPath = '/admin-login';
        apiMocks.apiGet.mockResolvedValue({ success: true });
        apiMocks.fetchPublicConfig.mockResolvedValue({
            success: true,
            data: {
                enablePublicPage: false,
                hasCustomLoginPath: true,
                isLoginPath: false,
                disguise: {
                    enabled: true,
                    pageType: 'redirect',
                    redirectUrl: 'https://example.org/',
                },
            },
        });
        expect(await store.logout()).toBe(true);
        expect(apiMocks.fetchPublicConfig).toHaveBeenCalledWith('/');
        expect(store.publicConfig.disguise.redirectUrl).toBe('https://example.org/');
        expect(store.sessionState).toBe('loggedOut');
        expect(routerMocks.push).toHaveBeenCalledExactlyOnceWith({ path: '/' });
    });

    it('ignores unauthorized responses while an intentional logout is pending', async () => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        let finishLogout;
        apiMocks.apiGet.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishLogout = resolve;
                })
        );
        const logout = store.logout();
        expect(store.isLoggingOut).toBe(true);
        expect(store.handleUnauthorized()).toBe(false);
        expect(store.sessionState).toBe('loggedIn');
        expect(apiMocks.cancelPendingRequests).toHaveBeenCalledWith(true);
        finishLogout({ success: true });
        await expect(logout).resolves.toBe(true);
        expect(store.sessionState).toBe('loggedOut');
        expect(store.isLoggingOut).toBe(false);
    });

    it('does not restore a session from a request that started before logout', async () => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        let finishSession;
        apiMocks.fetchInitialData.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finishSession = resolve;
                })
        );
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });
        const checking = store.checkSession();
        apiMocks.apiGet.mockResolvedValue({ success: true });
        await store.logout();
        finishSession({ success: true, data: { misubs: [{ id: 'stale' }] } });
        await expect(checking).resolves.toBe(false);
        expect(store.sessionState).toBe('loggedOut');
        expect(store.initialData).toBeNull();
    });

    it('clears an expired session only once while preserving the confirmed login entry', () => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        store.initialData = { misubs: [{ id: 'private-sub' }] };
        store.subscriptionConfig = { customLoginPath: 'admin-login' };
        store.securityWarning = { type: 'default_admin_password' };
        store.loginPath = '/admin-login';
        const clearCache = vi.spyOn(useDataStore(), 'resetSessionData');
        expect(store.handleUnauthorized()).toBe(true);
        expect(store.handleUnauthorized()).toBe(false);
        expect(store.sessionState).toBe('loggedOut');
        expect(store.initialData).toBeNull();
        expect(store.subscriptionConfig).toEqual({});
        expect(store.securityWarning).toBeNull();
        expect(store.loginPath).toBe('/admin-login');
        expect(clearCache).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])(
        'clears the session when logout is confirmed (%s)',
        async (logoutSuccess) => {
            const store = useSessionStore();
            store.sessionState = 'loggedIn';
            store.initialData = { misubs: [{ id: 'private-sub' }] };
            if (logoutSuccess) apiMocks.apiGet.mockResolvedValue({ success: true });
            else {
                apiMocks.apiGet.mockRejectedValue(new Error('network down'));
                apiMocks.fetchSessionStatus.mockResolvedValue({
                    success: false,
                    errorType: 'auth',
                });
                vi.spyOn(console, 'warn').mockImplementation(() => {});
            }
            await expect(store.logout()).resolves.toBe(true);
            expect(store.sessionState).toBe('loggedOut');
            expect(store.initialData).toBeNull();
            expect(routerMocks.push).toHaveBeenCalledWith({ path: '/' });
        }
    );

    it('preserves a known public configuration when a later request fails', async () => {
        const store = useSessionStore();
        apiMocks.fetchInitialData.mockResolvedValue({ success: false, errorType: 'auth' });
        apiMocks.fetchPublicConfig.mockResolvedValueOnce({
            success: true,
            data: { enablePublicPage: true, hasCustomLoginPath: true, isLoginPath: false },
        });
        await store.checkSession();
        const knownConfig = store.publicConfig;
        apiMocks.fetchPublicConfig.mockResolvedValueOnce({ success: false, error: 'network down' });
        await store.checkSession();
        expect(store.publicConfig).toEqual(knownConfig);
    });

    it.each([
        { success: true, data: {} },
        { success: false, errorType: 'network', error: 'network down' },
        { success: false, cancelled: true },
    ])('preserves session data when logout cannot be confirmed (%j)', async (sessionCheck) => {
        const store = useSessionStore();
        store.sessionState = 'loggedIn';
        store.initialData = { misubs: [{ id: 'private-sub' }] };
        apiMocks.apiGet.mockRejectedValue(new Error('network down'));
        apiMocks.fetchSessionStatus.mockResolvedValue(sessionCheck);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(store.logout()).resolves.toBe(false);
        expect(store.sessionState).toBe(
            sessionCheck.errorType === 'network' ? 'unverified' : 'loggedIn'
        );
        expect(store.initialData).toEqual({ misubs: [{ id: 'private-sub' }] });
        expect(routerMocks.push).not.toHaveBeenCalled();
    });

    it('does not navigate to the dashboard before session confirmation succeeds', async () => {
        const store = useSessionStore();
        let finishSession;
        apiMocks.fetchInitialData.mockReturnValue(
            new Promise((resolve) => {
                finishSession = resolve;
            })
        );
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });
        apiMocks.login.mockResolvedValue({ success: true, data: {} });
        const login = store.login('password');
        await vi.waitFor(() => expect(apiMocks.fetchInitialData).toHaveBeenCalled());
        expect(routerMocks.push).not.toHaveBeenCalled();
        finishSession({ success: true, data: {} });
        await login;
        expect(store.sessionState).toBe('loggedIn');
        expect(routerMocks.push).toHaveBeenCalledWith({ path: '/dashboard' });
    });

    it('rejects a login that cannot establish an authenticated session', async () => {
        const store = useSessionStore();
        apiMocks.login.mockResolvedValue({ success: true, data: {} });
        apiMocks.fetchInitialData.mockResolvedValue({ success: false, errorType: 'auth' });
        apiMocks.fetchPublicConfig.mockResolvedValue({ success: true, data: {} });
        await expect(store.login('password')).rejects.toThrow();
        expect(routerMocks.push).not.toHaveBeenCalled();
        expect(store.sessionState).toBe('loggedOut');
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
