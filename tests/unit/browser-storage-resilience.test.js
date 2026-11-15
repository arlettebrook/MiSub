import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { readStorage, writeStorage } from '../../src/utils/browser-storage.js';
import { ASSET_RELOAD_KEY, CHUNK_RELOAD_KEY, claimReload } from '../../src/utils/chunk-reload.js';
import { useManualNodes } from '../../src/composables/useManualNodes.js';
import { useDataStore } from '../../src/stores/useDataStore.js';
import { useUIStore } from '../../src/stores/ui.js';
import { useVersionStore } from '../../src/stores/version.js';
import {
    createI18n,
    detectInitialLocale,
    hasStoredLocale,
    setLocale,
} from '../../src/i18n/index.js';
import { ErrorHandler } from '../../src/utils/errorHandler.js';

const { fetchGithubLatestRelease } = vi.hoisted(() => ({ fetchGithubLatestRelease: vi.fn() }));
vi.mock('../../src/lib/api.js', () => ({ fetchGithubLatestRelease }));
vi.mock('../../src/utils/ping.js', () => ({ pingNode: vi.fn() }));

let originalLocalStorage;
let originalSessionStorage;
let scope;
beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    originalSessionStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    setActivePinia(createPinia());
    scope = effectScope();
    setLocale('zh-CN');
});

afterEach(() => {
    scope.stop();
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
    Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
    setLocale('zh-CN');
});

function failStorage(name, failure) {
    const real = globalThis[name];
    // Happy DOM binds Storage methods through a proxy. Use a mockable facade.
    const storage = {
        getItem: (key) => real.getItem(key),
        setItem: (key, value) => real.setItem(key, value),
    };
    Object.defineProperty(globalThis, name, { configurable: true, value: storage });
    if (failure === 'getter') {
        Object.defineProperty(globalThis, name, {
            configurable: true,
            get() {
                throw new DOMException('Blocked', 'SecurityError');
            },
        });
    } else if (failure === 'missing') {
        Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
    } else if (failure === 'read') {
        vi.spyOn(storage, 'getItem').mockImplementation(() => {
            throw new Error('Read blocked');
        });
    } else if (failure === 'write') {
        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new DOMException('Full', 'QuotaExceededError');
        });
    } else if (failure === 'dropped') {
        vi.spyOn(storage, 'setItem').mockImplementation(() => {});
    }
}

describe('optional browser preferences', () => {
    it('preserves stored strings and reports normal writes', () => {
        expect(writeStorage('preference', 48)).toBe(true);
        expect(readStorage('preference')).toBe('48');
        expect(readStorage('missing')).toBeNull();
        expect(writeStorage('session', 'value', 'sessionStorage')).toBe(true);
        expect(readStorage('session', null, 'sessionStorage')).toBe('value');
    });

    it.each(['getter', 'missing', 'read'])(
        'uses defaults when localStorage has a %s failure',
        (failure) => {
            failStorage('localStorage', failure);
            expect(readStorage('preference', 'default')).toBe('default');
            const ui = useUIStore();
            expect(ui.layoutMode).toBe('modern');
            const nodes = scope.run(() => useManualNodes(vi.fn()));
            expect(nodes.manualNodesPerPage.value).toBe(24);
            expect(detectInitialLocale(['en-US'])).toBe('en-US');
            expect(hasStoredLocale()).toBe(false);
            const language = createI18n({ initialLocale: 'zh-CN' });
            expect(() => language.setLocale('en-US')).not.toThrow();
            expect(language.locale.value).toBe('en-US');
        }
    );

    it.each(['getter', 'missing', 'write'])(
        'keeps pagination and node drafts usable on %s failures',
        async (failure) => {
            const dirty = vi.fn();
            const nodes = scope.run(() => useManualNodes(dirty));
            const data = useDataStore();
            data.subscriptions = Array.from({ length: 70 }, (_, index) => ({
                id: `n${index}`,
                name: `Node ${index}`,
                url: `trojan://test@node${index}.example:443`,
                enabled: true,
            }));
            nodes.manualNodesCurrentPage.value = 2;
            failStorage('localStorage', failure);
            nodes.manualNodesPerPage.value = 48;
            await nextTick();
            expect(nodes.manualNodesCurrentPage.value).toBe(1);
            expect(nodes.paginatedManualNodes.value).toHaveLength(48);
            expect(data.subscriptions).toHaveLength(70);
            expect(dirty).not.toHaveBeenCalled();
            expect(writeStorage('preference', 48)).toBe(false);
        }
    );

    it.each([12, 48, -1])('restores the saved page size %s, including all nodes', (value) => {
        localStorage.setItem('manualNodesPPS', String(value));
        const nodes = scope.run(() => useManualNodes(vi.fn()));
        expect(nodes.manualNodesPerPage.value).toBe(value);
    });

    it('switches layout in memory when the preference cannot be written', () => {
        const ui = useUIStore();
        failStorage('localStorage', 'write');
        const initialHref = window.location.href;
        expect(() => ui.toggleLayout()).not.toThrow();
        expect(ui.layoutMode).toBe('legacy');
        expect(window.location.href).toBe(initialHref);
        ui.toggleLayout();
        expect(ui.layoutMode).toBe('modern');
    });

    it('can dismiss release notes even when preference storage is full', async () => {
        const version = useVersionStore();
        fetchGithubLatestRelease.mockResolvedValue({ tag_name: version.currentVersion });
        failStorage('localStorage', 'read');
        await version.checkVersion();
        expect(version.showModal).toBe(true);
        failStorage('localStorage', 'write');
        expect(() => version.suppressUpdateModal()).not.toThrow();
        expect(version.showModal).toBe(false);
    });

    it('initializes the language singleton even when the storage getter throws', async () => {
        failStorage('localStorage', 'getter');
        vi.resetModules();
        const imported = await import('../../src/i18n/index.js');
        expect(imported.i18n.t('nav.dashboard')).not.toBe('nav.dashboard');
    });
});

describe.each([CHUNK_RELOAD_KEY, ASSET_RELOAD_KEY])('persistent recovery marker %s', (key) => {
    it('allows recovery once and refuses it on a later invocation', () => {
        expect(claimReload(key)).toBe('ready');
        expect(sessionStorage.getItem(key)).toBe('1');
        expect(claimReload(key)).toBe('already-reloaded');
    });

    it.each(['getter', 'missing', 'read', 'write', 'dropped'])(
        'refuses automatic reload on %s failure',
        (failure) => {
            failStorage('sessionStorage', failure);
            expect(() => claimReload(key)).not.toThrow();
            expect(claimReload(key)).toBe('unavailable');
        }
    );

    it('refuses reload if reading back the marker throws', () => {
        failStorage('sessionStorage', 'normal');
        const storage = sessionStorage;
        vi.spyOn(storage, 'getItem')
            .mockReturnValueOnce(null)
            .mockImplementation(() => {
                throw new Error('Readback blocked');
            });
        expect(claimReload(key)).toBe('unavailable');
    });

    it('refuses reload when a write preserves a different value', () => {
        sessionStorage.setItem(key, 'old');
        failStorage('sessionStorage', 'dropped');
        expect(claimReload(key)).toBe('unavailable');
        expect(sessionStorage.getItem(key)).toBe('old');
    });

    it('does not overwrite a confirmed recovery marker', () => {
        sessionStorage.setItem(key, '1');
        failStorage('sessionStorage', 'normal');
        const write = vi.spyOn(sessionStorage, 'setItem');
        expect(claimReload(key)).toBe('already-reloaded');
        expect(write).not.toHaveBeenCalled();
    });
});

describe('manual recovery feedback', () => {
    it.each(['zh-CN', 'en-US'])('shows a manual refresh instruction in %s', (locale) => {
        setLocale(locale);
        const handler = new ErrorHandler();
        const text = handler.getUserFriendlyMessage({
            message: 'Failed to fetch dynamically imported module',
            additionalData: { recoveryBlocked: true },
        });
        expect(text).toMatch(locale === 'zh-CN' ? /手动刷新/ : /refresh the page manually/);
    });
});
