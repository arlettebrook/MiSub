import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebdavBackupSettings from '../../src/components/settings/sections/WebdavBackupSettings.vue';
import { createI18n } from '../../src/i18n/index.js';
import { DEFAULT_SETTINGS } from '../../src/constants/default-settings.js';
import { useConfirmState } from '../../src/composables/useConfirm.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), showToast: vi.fn() }));
vi.mock('../../src/lib/http.js', () => ({ api: { get: mocks.get, post: mocks.post } }));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: mocks.showToast }),
}));

const files = [
    { name: 'misub-backup-new.json', path: '/MiSub/misub-backup-new.json' },
    { name: 'misub-backup-测试 12-00-00.json', path: '/MiSub/misub-backup-测试 12-00-00.json' },
];
let wrapper;
let blob;
let downloadedName;
let anchorClick;

beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ success: true, data: files });
    mocks.post.mockReset();
    mocks.showToast.mockReset();
    blob = undefined;
    downloadedName = undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((value) => {
        blob = value;
        return 'blob:remote-backup';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
        downloadedName = this.download;
    });
});

afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
});

async function loadRemoteFiles() {
    wrapper = mount(WebdavBackupSettings, {
        props: { settings: { webdavBackup: { ...DEFAULT_SETTINGS.webdavBackup } } },
        global: { plugins: [createI18n({ initialLocale: 'en-US' })] },
    });
    await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Load remote backups')
        .trigger('click');
    await flushPromises();
    return wrapper.findAll('button').filter((button) => button.text() === 'Download');
}

describe('remote backup downloads', () => {
    it('downloads the selected backup under its original name without a restore confirmation', async () => {
        const payload = {
            type: 'misub-backup',
            scope: 'dataAndSettings',
            exportedAt: '2026-08-09T04:00:00.000Z',
            data: { subscriptions: [{ id: 'remote-sub' }], settings: { FileName: 'Remote' } },
        };
        let finishDownload;
        mocks.post.mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishDownload = resolve;
                })
        );
        const buttons = await loadRemoteFiles();
        await buttons[1].trigger('click');

        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/backup/webdav/download', {
            file: files[1].path,
        });
        expect(useConfirmState().value).toBeNull();
        expect(buttons[1].text()).toBe('Downloading...');
        expect(buttons.every((button) => button.element.disabled)).toBe(true);
        finishDownload({ success: true, exportData: payload });
        await flushPromises();

        expect(downloadedName).toBe(files[1].name);
        expect(blob.type).toBe('application/json');
        expect(JSON.parse(await blob.text())).toEqual(payload);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:remote-backup');
        expect(buttons.every((button) => !button.element.disabled)).toBe(true);
        expect(mocks.showToast).toHaveBeenLastCalledWith('Backup download started', 'success');
    });

    it.each([
        { success: false, message: 'Remote file missing' },
        { success: true },
        new Error('Network unavailable'),
    ])('shows download failures and allows retry (%j)', async (result) => {
        if (result instanceof Error) mocks.post.mockRejectedValue(result);
        else mocks.post.mockResolvedValue(result);
        const buttons = await loadRemoteFiles();
        await buttons[0].trigger('click');
        await flushPromises();

        expect(anchorClick).not.toHaveBeenCalled();
        expect(mocks.showToast).toHaveBeenLastCalledWith(
            expect.stringContaining('Failed to download backup:'),
            'error'
        );
        expect(buttons[0].text()).toBe('Download');
        expect(buttons[0].element.disabled).toBe(false);
        expect(useConfirmState().value).toBeNull();
    });
});
