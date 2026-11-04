import { ref } from 'vue';
import { defineStore } from 'pinia';
import router from '../router';
import { fetchInitialData, login as apiLogin, fetchPublicConfig } from '../lib/api';
import { api, cancelPendingRequests } from '../lib/http.js';
import { handleError } from '../utils/errorHandler.js';
import { useDataStore } from './useDataStore';
import { useUIStore } from './ui.js';
import { loadLegacyDashboard } from '../router/component-loaders.js';
import { t } from '../i18n/index.js';
import { normalizeLoginPath, readRememberedLoginPath } from '../utils/login-path.js';

export const useSessionStore = defineStore('session', () => {
    const sessionState = ref('loading'); // loading, loggedIn, loggedOut
    const isLoggingOut = ref(false);
    let sessionCheckId = 0;
    const initialData = ref(null);
    const subscriptionConfig = ref({}); // [NEW] Added subscriptionConfig
    const securityWarning = ref(null);
    const defaultPublicConfig = Object.freeze({
        enablePublicPage: true,
        isLoginPath: false,
        hasCustomLoginPath: false,
        customLoginPath: 'login',
        customPage: {
            enabled: false,
            useDefaultLayout: true,
            allowExternalStylesheets: false,
            allowScripts: false,
            hideBranding: false,
            hideHeader: false,
            hideFooter: false,
        },
    });

    const disabledPublicConfig = Object.freeze({
        ...defaultPublicConfig,
        enablePublicPage: false,
    });

    const publicConfig = ref({
        ...defaultPublicConfig,
        customPage: { ...defaultPublicConfig.customPage },
    }); // Default true until fetched
    const hasLoadedPublicConfig = ref(false);
    const publicConfigPath = ref('');
    const loginPath = ref(readRememberedLoginPath());

    function rememberLoginPath(path) {
        loginPath.value = normalizeLoginPath(path);
        try {
            sessionStorage.setItem('misub:login-path', loginPath.value);
        } catch {
            // The confirmed entry remains available for this page when storage is blocked.
        }
    }

    function updatePublicConfig(result, pathname) {
        if (result.success) {
            publicConfig.value = result.data;
            hasLoadedPublicConfig.value = true;
            publicConfigPath.value = pathname;
            if (typeof result.data?.customLoginPath === 'string') {
                rememberLoginPath(result.data.customLoginPath);
            } else if (result.data?.hasCustomLoginPath === false) {
                rememberLoginPath('/login');
            } else if (result.data?.isLoginPath === true && pathname) {
                rememberLoginPath(pathname);
            }
        } else if (!hasLoadedPublicConfig.value) {
            publicConfig.value = {
                ...disabledPublicConfig,
                customPage: { ...disabledPublicConfig.customPage },
            };
        }
    }

    async function checkLoginPath(pathname) {
        let result;
        if (hasLoadedPublicConfig.value && publicConfigPath.value === pathname) {
            result = { success: true, data: publicConfig.value };
        } else {
            result = await fetchPublicConfig(pathname);
            if (result.cancelled) return false;
            updatePublicConfig(result, pathname);
        }
        if (!result.success) return pathname === loginPath.value;
        if (typeof result.data?.isLoginPath === 'boolean') return result.data.isLoginPath;
        // Support a cached response from an older server during a deployment.
        return pathname === normalizeLoginPath(result.data?.customLoginPath);
    }

    function clearSessionData() {
        initialData.value = null;
        subscriptionConfig.value = {};
        securityWarning.value = null;
        useDataStore().clearCachedData();
    }

    function handleUnauthorized() {
        if (sessionState.value !== 'loggedIn' || isLoggingOut.value) return false;
        sessionCheckId++;
        sessionState.value = 'loggedOut';
        clearSessionData();
        return true;
    }

    function suspendSession() {
        sessionCheckId++;
        sessionState.value = 'loading';
        cancelPendingRequests(true);
    }

    async function checkSession(navigationReady) {
        const checkId = ++sessionCheckId;
        const pathname = globalThis.window?.location?.pathname || '/login';
        // Parallel fetch of initial data (auth check) and public config
        const [dataResult, pConfigResult] = await Promise.all([
            fetchInitialData(),
            fetchPublicConfig(pathname),
        ]);

        if (checkId !== sessionCheckId || dataResult.cancelled || pConfigResult.cancelled) {
            return false;
        }

        // Update public config
        updatePublicConfig(pConfigResult, pathname);

        if (dataResult.success) {
            // Confirm authentication before navigating, and reveal the page only when it is ready.
            await (typeof navigationReady === 'function' ? navigationReady() : navigationReady);
            if (checkId !== sessionCheckId) return false;
            initialData.value = dataResult.data;
            if (dataResult.data.config) {
                subscriptionConfig.value = dataResult.data.config;
                if (typeof dataResult.data.config.customLoginPath === 'string') {
                    rememberLoginPath(dataResult.data.config.customLoginPath);
                }
            }

            // 直接注入数据到 dataStore，避免 Dashboard 重复请求
            const dataStore = useDataStore();
            dataStore.hydrateFromData(dataResult.data);

            sessionState.value = 'loggedIn';
            return true;
        } else {
            clearSessionData();
            // Auth failed or other error
            if (dataResult.errorType === 'auth') {
                sessionState.value = 'loggedOut';
            } else {
                // Network or other error, still show logged out
                console.error('Session check failed:', dataResult.error);
                handleError(
                    new Error(dataResult.error || t('settings.sessionCheckFailed')),
                    t('settings.sessionCheckContext'),
                    {
                        errorType: dataResult.errorType,
                    }
                );
                sessionState.value = 'loggedOut';
            }
            return false;
        }
    }

    async function login(password) {
        const result = await apiLogin(password);
        if (result.cancelled) return;
        if (result.success) {
            securityWarning.value = result.data?.securityWarning || null;
            sessionState.value = 'loading';
            try {
                const legacyReady = Promise.allSettled([
                    useUIStore().layoutMode === 'legacy' ? loadLegacyDashboard() : undefined,
                ]);
                const authenticated = await checkSession(async () => {
                    const [, [legacyResult]] = await Promise.all([
                        router.push({ path: '/dashboard' }),
                        legacyReady,
                    ]);
                    if (legacyResult.status === 'rejected') throw legacyResult.reason;
                });
                if (!authenticated) throw new Error(t('settings.sessionCheckFailed'));
            } catch (error) {
                sessionState.value = 'loggedOut';
                throw error;
            }
        } else {
            throw new Error(result.error || t('settings.loginFailed'));
        }
    }

    async function logout() {
        if (isLoggingOut.value) return false;
        isLoggingOut.value = true;
        sessionCheckId++;
        cancelPendingRequests(true);
        try {
            let logoutConfirmed = false;
            try {
                await api.get('/api/logout');
                logoutConfirmed = true;
            } catch (error) {
                if (error.cancelled) return false;
                console.warn('Logout request failed:', error);
            }
            if (!logoutConfirmed) {
                const sessionCheck = await fetchInitialData();
                if (sessionCheck.success || sessionCheck.errorType !== 'auth') {
                    handleError(
                        new Error(t('settings.logoutFailed')),
                        t('settings.logoutContext'),
                        {
                            errorType: 'logout_failed',
                        }
                    );
                    return false;
                }
            }
            sessionCheckId++;
            sessionState.value = 'loggedOut';
            clearSessionData();

            // 跳转到首页（公开页）
            await router.push({ path: '/' });
            return true;
        } finally {
            isLoggingOut.value = false;
        }
    }

    return {
        sessionState,
        isLoggingOut,
        initialData,
        publicConfig,
        loginPath,
        subscriptionConfig,
        securityWarning,
        checkSession,
        suspendSession,
        checkLoginPath,
        handleUnauthorized,
        login,
        logout,
    };
});
