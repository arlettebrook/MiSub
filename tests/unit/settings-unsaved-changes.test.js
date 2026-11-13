import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';

const { fetchSettings, saveSettings } = vi.hoisted(() => ({
    fetchSettings: vi.fn(),
    saveSettings: vi.fn(),
}));

vi.mock('../../src/lib/api.js', () => ({
    fetchSettings,
    saveSettings,
    resetSettings: vi.fn(),
}));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../src/composables/useBackupLogic.js', () => ({
    useBackupLogic: () => ({ exportBackup: vi.fn(), importBackup: vi.fn() }),
}));

import { useSettingsLogic } from '../../src/composables/useSettingsLogic.js';

describe('settings unsaved changes', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        fetchSettings.mockResolvedValue({
            success: true,
            data: {
                FileName: 'Original',
                storageType: 'kv',
                externalApi: { enabled: false, tokens: [{ name: 'default', token: 'abc' }] },
                disguise: { enabled: false, pageType: 'default', redirectUrl: '' },
            },
        });
        saveSettings.mockReset();
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('starts clean and clears changes when fields, nested config, or disguise are reverted', async () => {
        const { settings, disguiseConfig, hasUnsavedChanges, loadSettings } = useSettingsLogic();
        await loadSettings();
        expect(hasUnsavedChanges.value).toBe(false);

        settings.value.FileName = 'Edited';
        expect(hasUnsavedChanges.value).toBe(true);
        settings.value.FileName = 'Original';
        expect(hasUnsavedChanges.value).toBe(false);

        settings.value.externalApi.tokens[0].token = 'changed';
        expect(hasUnsavedChanges.value).toBe(true);
        settings.value.externalApi.tokens[0].token = 'abc';
        expect(hasUnsavedChanges.value).toBe(false);

        disguiseConfig.value.enabled = true;
        expect(hasUnsavedChanges.value).toBe(true);
        disguiseConfig.value.enabled = false;
        expect(hasUnsavedChanges.value).toBe(false);
    });

    it('includes section defaults applied during the initial render in the clean baseline', async () => {
        const { settings, isLoading, hasUnsavedChanges, loadSettings } = useSettingsLogic();
        const stop = watch(isLoading, (loading) => {
            if (!loading) settings.value.defaultOperators = [];
        });
        await loadSettings();
        stop();
        expect(settings.value.defaultOperators).toEqual([]);
        expect(hasUnsavedChanges.value).toBe(false);
    });

    it('normalizes lazy section defaults without relying on section mounting', async () => {
        fetchSettings.mockResolvedValueOnce({
            success: true,
            data: {
                defaultOperators: null,
                regionOverrides: null,
                guestbook: null,
                webdavBackup: null,
                customPage: { type: 'iframe', allowScripts: null },
                subconverter: { engineMode: 'external' },
                transformConfigMode: 'builtin',
                transformConfig: 'builtin:standard',
                builtinEnableUdp: true,
            },
        });
        const { settings, loadSettings, hasUnsavedChanges } = useSettingsLogic();
        await loadSettings();
        expect(settings.value.defaultOperators).toEqual([]);
        expect(settings.value.regionOverrides).toEqual([]);
        expect(settings.value.guestbook.enabled).toBe(false);
        expect(settings.value.webdavBackup.remotePath).toBe('/MiSub');
        expect(settings.value.customPage.type).toBe('html');
        expect(settings.value.customPage.allowScripts).toBe(false);
        expect(settings.value.subconverter.defaultOptions.udp).toBe(true);
        expect(settings.value.transformConfigMode).toBe('preset');
        expect(settings.value.transformConfig).toBe('');
        expect(settings.value.builtinEnableUdp).toBe(false);
        expect(hasUnsavedChanges.value).toBe(false);
        settings.value.FileName = 'Edited';
        expect(hasUnsavedChanges.value).toBe(true);
    });

    it('keeps changes after a failed save and clears them after a successful save', async () => {
        const { settings, hasUnsavedChanges, loadSettings, handleSave } = useSettingsLogic();
        await loadSettings();
        settings.value.FileName = 'Edited';
        saveSettings.mockResolvedValueOnce({ success: false, error: 'Save failed' });
        expect(await handleSave()).toBe(false);
        expect(hasUnsavedChanges.value).toBe(true);

        saveSettings.mockResolvedValueOnce({ success: true });
        expect(await handleSave()).toBe(true);
        expect(hasUnsavedChanges.value).toBe(false);
    });

    it('only marks the submitted values as saved and blocks duplicate saves', async () => {
        const { settings, disguiseConfig, hasUnsavedChanges, loadSettings, handleSave } =
            useSettingsLogic();
        await loadSettings();
        disguiseConfig.value.redirectUrl = 'https://original.example';
        let resolveSave;
        saveSettings.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
        const pendingSave = handleSave();
        settings.value.FileName = 'New edit during save';
        disguiseConfig.value.redirectUrl = 'https://new.example';
        expect(await handleSave()).toBe(false);
        expect(saveSettings).toHaveBeenCalledTimes(1);
        expect(saveSettings.mock.calls[0][0].disguise.redirectUrl).toBe('https://original.example');
        resolveSave({ success: true });
        await pendingSave;
        expect(hasUnsavedChanges.value).toBe(true);
    });
});
