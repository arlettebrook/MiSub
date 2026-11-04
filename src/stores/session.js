import { ref, watch, onScopeDispose } from 'vue';
import { defineStore, getActivePinia } from 'pinia';
import router from '../router';
import {
    fetchInitialData,
    fetchSessionStatus,
    login as apiLogin,
    fetchPublicConfig,
} from '../lib/api';
import { api, cancelPendingRequests, cancelPrivateRequests } from '../lib/http.js';
import { handleError } from '../utils/errorHandler.js';
import { useDataStore } from './useDataStore';
import { useUIStore } from './ui.js';
import { loadLegacyDashboard } from '../router/component-loaders.js';
import { t } from '../i18n/index.js';
import { normalizeLoginPath, readRememberedLoginPath } from '../utils/login-path.js';
import { createSessionSync, readSessionEvent, LOGOUT_PENDING_MS } from '../utils/session-sync.js';

export const useSessionStore = defineStore('session', () => {
    const pinia = getActivePinia();
    const sessionState = ref('loading'); // loading, loggedIn, loggedOut, unverified
    const isLoggingOut = ref(false);
    const hasAuthenticatedSession = ref(false);
    const isVerifyingSession = ref(false);
    const isRemoteLogoutPending = ref(false);
    const verificationReason = ref('checking');
    let sync;
    let verificationPromise;
    let retryTimer;
    let pendingLogoutTimer;
    let retryAttempt = 0;
    const retryDelays = [1000, 3000, 10000, 30000];
    let sessionCheckId = 0;
    watch(
        sessionState,
        (state) => {
            if (state === 'loggedIn') hasAuthenticatedSession.value = true;
            if (state === 'loggedOut') hasAuthenticatedSession.value = false;
        },
        { flush: 'sync' }
    );
    const initialData = ref(null);
    const subscriptionConfig = ref({}); // [NEW] Added subscriptionConfig
    const securityWarning = ref(null);
    const defaultPublicConfig = Object.freeze({
        enablePublicPage: true,
        isLoginPath: false,
        hasCustomLoginPath: false,
        customLoginPath: 'login',
        disguise: { enabled: false, pageType: 'default', redirectUrl: '' },
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
        if (!result.success) return false;
        if (typeof result.data?.isLoginPath === 'boolean') return result.data.isLoginPath;
        // Support a cached response from an older server during a deployment.
        return pathname === normalizeLoginPath(result.data?.customLoginPath);
    }

    function clearSessionData() {
        initialData.value = null;
        subscriptionConfig.value = {};
        securityWarning.value = null;
        useDataStore(pinia).resetSessionData();
        useUIStore(pinia).hide();
    }

    function clearRetry() {
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryAttempt = 0;
    }

    function finishLoggedOut() {
        sessionCheckId++;
        verificationPromise = undefined;
        clearRetry();
        clearTimeout(pendingLogoutTimer);
        isRemoteLogoutPending.value = false;
        isVerifyingSession.value = false;
        sessionState.value = 'loggedOut';
        cancelPrivateRequests();
        clearSessionData();
    }

    function scheduleRetry() {
        if (
            !sync ||
            retryTimer ||
            retryAttempt >= retryDelays.length ||
            sessionState.value !== 'unverified' ||
            isRemoteLogoutPending.value ||
            document.visibilityState === 'hidden' ||
            navigator.onLine === false
        )
            return;
        retryTimer = setTimeout(() => {
            retryTimer = undefined;
            retryAttempt++;
            void revalidateSession();
        }, retryDelays[retryAttempt]);
    }

    function reportConnectionIssue(force = false) {
        if (
            isLoggingOut.value ||
            isRemoteLogoutPending.value ||
            (sessionState.value === 'loggedOut' && !force)
        )
            return;
        sessionCheckId++;
        verificationPromise = undefined;
        sessionState.value = 'unverified';
        verificationReason.value = 'connection';
        isVerifyingSession.value = false;
        cancelPrivateRequests();
        scheduleRetry();
    }

    function receiveSessionEvent(event) {
        if (event.type === 'logout') {
            finishLoggedOut();
        } else if (event.type === 'logout-start' && sessionState.value !== 'loggedOut') {
            sessionCheckId++;
            verificationPromise = undefined;
            clearRetry();
            isRemoteLogoutPending.value = true;
            sessionState.value = 'unverified';
            verificationReason.value = 'logout';
            isVerifyingSession.value = false;
            cancelPrivateRequests();
            clearTimeout(pendingLogoutTimer);
            pendingLogoutTimer = setTimeout(() => {
                isRemoteLogoutPending.value = false;
                void retrySession();
            }, LOGOUT_PENDING_MS);
        } else if (event.type === 'logout-cancelled' && isRemoteLogoutPending.value) {
            clearTimeout(pendingLogoutTimer);
            isRemoteLogoutPending.value = false;
            void retrySession();
        }
    }

    function canSendPrivateRequest() {
        sync?.consume();
        return (
            sessionState.value === 'loggedIn' &&
            !isLoggingOut.value &&
            !isRemoteLogoutPending.value &&
            !isVerifyingSession.value
        );
    }

    function handleUnauthorized() {
        sync?.consume();
        if (isLoggingOut.value || isRemoteLogoutPending.value || sessionState.value === 'loggedOut')
            return false;
        const notify = sessionState.value === 'loggedIn';
        finishLoggedOut();
        return notify;
    }

    function suspendSession() {
        sessionCheckId++;
        verificationPromise = undefined;
        sessionState.value = 'loading';
        verificationReason.value = 'checking';
        isVerifyingSession.value = false;
        clearRetry();
        cancelPrivateRequests();
        cancelPendingRequests(true);
    }

    function isCurrentCheck(checkId, eventId) {
        if (readSessionEvent()?.id !== eventId) {
            sync?.consume();
            return false;
        }
        return checkId === sessionCheckId && !isRemoteLogoutPending.value && !isLoggingOut.value;
    }

    async function checkSession(navigationReady) {
        const checkId = ++sessionCheckId;
        const eventId = readSessionEvent()?.id;
        const preserveData = initialData.value !== null && hasAuthenticatedSession.value;
        isVerifyingSession.value = true;
        const pathname = globalThis.window?.location?.pathname || '/login';
        // Parallel fetch of initial data (auth check) and public config
        const [dataResult, pConfigResult] = await Promise.all([
            fetchInitialData(),
            fetchPublicConfig(pathname),
        ]);

        updatePublicConfig(pConfigResult, pathname);
        if (!isCurrentCheck(checkId, eventId) || dataResult.cancelled || pConfigResult.cancelled) {
            if (checkId === sessionCheckId) isVerifyingSession.value = false;
            return false;
        }

        if (dataResult.success) {
            // Confirm authentication before navigating, and reveal the page only when it is ready.
            await (typeof navigationReady === 'function' ? navigationReady() : navigationReady);
            if (!isCurrentCheck(checkId, eventId)) return false;
            if (!preserveData) initialData.value = dataResult.data;
            if (dataResult.data.config) {
                subscriptionConfig.value = dataResult.data.config;
                if (typeof dataResult.data.config.customLoginPath === 'string') {
                    rememberLoginPath(dataResult.data.config.customLoginPath);
                }
            }

            // 直接注入数据到 dataStore，避免 Dashboard 重复请求
            if (!preserveData) useDataStore(pinia).hydrateFromData(dataResult.data);

            sessionState.value = 'loggedIn';
            isVerifyingSession.value = false;
            clearRetry();
            return true;
        } else {
            if (dataResult.errorType === 'auth') {
                finishLoggedOut();
            } else {
                reportConnectionIssue(true);
            }
            return false;
        }
    }

    function revalidateSession() {
        sync?.consume();
        if (isLoggingOut.value || isRemoteLogoutPending.value) return Promise.resolve(false);
        if (verificationPromise) return verificationPromise;
        const checkId = ++sessionCheckId;
        const eventId = readSessionEvent()?.id;
        isVerifyingSession.value = true;
        sessionState.value = 'loading';
        verificationReason.value = 'checking';
        const pending = Promise.resolve().then(async () => {
            try {
                const pathname = globalThis.window?.location?.pathname || '/';
                const [result, config] = await Promise.all([
                    fetchSessionStatus(),
                    fetchPublicConfig(pathname),
                ]);
                updatePublicConfig(config, pathname);
                if (!isCurrentCheck(checkId, eventId) || result.cancelled) return false;
                if (!result.success) {
                    if (result.errorType === 'auth') finishLoggedOut();
                    else reportConnectionIssue(true);
                    return false;
                }
                if (initialData.value === null) return await checkSession();
                sessionState.value = 'loggedIn';
                clearRetry();
                return true;
            } finally {
                if (checkId === sessionCheckId) isVerifyingSession.value = false;
                if (verificationPromise === pending) verificationPromise = undefined;
                scheduleRetry();
            }
        });
        verificationPromise = pending;
        return pending;
    }

    function retrySession() {
        clearRetry();
        return revalidateSession();
    }

    const handleForeground = () => {
        sync?.consume();
        if (
            !isRemoteLogoutPending.value &&
            document.visibilityState !== 'hidden' &&
            (hasAuthenticatedSession.value || sessionState.value === 'unverified')
        )
            void retrySession();
    };
    const handleOffline = () => reportConnectionIssue();
    const handleVisibility = () => {
        if (document.visibilityState === 'hidden') clearRetry();
        else handleForeground();
    };

    function startSessionSync() {
        if (sync) return;
        sync = createSessionSync(receiveSessionEvent);
        const event = readSessionEvent();
        if (event?.type === 'logout-start' && Date.now() - event.time < LOGOUT_PENDING_MS)
            receiveSessionEvent(event);
        window.addEventListener('online', handleForeground);
        window.addEventListener('focus', handleForeground);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleVisibility);
    }

    function stopSessionSync() {
        sessionCheckId++;
        verificationPromise = undefined;
        isVerifyingSession.value = false;
        cancelPrivateRequests();
        sync?.close();
        sync = undefined;
        clearRetry();
        clearTimeout(pendingLogoutTimer);
        window.removeEventListener('online', handleForeground);
        window.removeEventListener('focus', handleForeground);
        window.removeEventListener('offline', handleOffline);
        document.removeEventListener('visibilitychange', handleVisibility);
    }
    onScopeDispose(stopSessionSync);

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
                isVerifyingSession.value = false;
                if (sessionState.value !== 'unverified') finishLoggedOut();
                throw error;
            }
        } else {
            if (result.errorType !== 'auth') reportConnectionIssue(true);
            throw new Error(result.error || t('settings.loginFailed'));
        }
    }

    async function logout() {
        if (isLoggingOut.value) return false;
        isLoggingOut.value = true;
        sessionCheckId++;
        sync?.publish('logout-start');
        cancelPrivateRequests();
        cancelPendingRequests(true);
        let logoutConfirmed = false;
        try {
            try {
                await api.get('/api/logout', { timeoutMs: 8000 });
                logoutConfirmed = true;
            } catch (error) {
                if (error.cancelled) return false;
                console.warn('Logout request failed:', error);
            }
            if (!logoutConfirmed) {
                const sessionCheck = await fetchSessionStatus();
                if (sessionCheck.success || sessionCheck.errorType !== 'auth') {
                    if (!sessionCheck.success && !sessionCheck.cancelled) {
                        isLoggingOut.value = false;
                        reportConnectionIssue(true);
                    }
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
            logoutConfirmed = true;
            finishLoggedOut();
            sync?.publish('logout');
            // Refresh root-page visibility and disguise settings before revealing the logged-out page.
            const configResult = await fetchPublicConfig('/');
            if (!configResult.cancelled) updatePublicConfig(configResult, '/');
            // Root shows the public page or the configured disguise.
            await router.push({ path: '/' });
            return true;
        } finally {
            if (!logoutConfirmed) sync?.publish('logout-cancelled');
            isLoggingOut.value = false;
        }
    }

    return {
        sessionState,
        isLoggingOut,
        hasAuthenticatedSession,
        isVerifyingSession,
        isRemoteLogoutPending,
        verificationReason,
        initialData,
        publicConfig,
        loginPath,
        subscriptionConfig,
        securityWarning,
        checkSession,
        revalidateSession,
        retrySession,
        reportConnectionIssue,
        canSendPrivateRequest,
        startSessionSync,
        stopSessionSync,
        suspendSession,
        checkLoginPath,
        handleUnauthorized,
        login,
        logout,
    };
});
