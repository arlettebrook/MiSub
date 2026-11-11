import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmDialog from '../../src/components/ui/ConfirmDialog.vue';
import LogModal from '../../src/components/modals/LogModal.vue';
import WebdavBackupSettings from '../../src/components/settings/sections/WebdavBackupSettings.vue';
import CustomPageSettings from '../../src/components/settings/sections/CustomPageSettings.vue';
import GroupManagementModal from '../../src/components/modals/GroupManagementModal.vue';
import { createI18n } from '../../src/i18n/index.js';
import { DEFAULT_SETTINGS } from '../../src/constants/default-settings.js';
import { settleConfirm, useConfirmState } from '../../src/composables/useConfirm.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn(), showToast: vi.fn() }));
vi.mock('../../src/lib/http.js', () => ({
    api: { get: mocks.get, post: mocks.post, del: mocks.del },
}));
vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({ showToast: mocks.showToast }),
}));

let wrapper;
let i18n;
const click = async (element) => {
    element.focus();
    element.click();
    await flushPromises();
};
const button = (key) =>
    Array.from(document.querySelectorAll('button')).find(
        (element) => element.textContent.trim() === i18n.t(key)
    );
const confirmation = () =>
    Array.from(document.querySelectorAll('[role="dialog"]')).find(
        (element) => element.style.zIndex === 'var(--z-confirm)'
    );

beforeEach(() => {
    i18n = createI18n({ initialLocale: 'en-US' });
    mocks.get.mockReset().mockResolvedValue({ data: [] });
    mocks.post.mockReset().mockResolvedValue({ success: true });
    mocks.del.mockReset().mockResolvedValue({ success: true });
    mocks.showToast.mockReset();
});
afterEach(async () => {
    wrapper?.unmount();
    settleConfirm(false);
    await nextTick();
    document.body.innerHTML = '';
    vi.clearAllTimers();
    vi.useRealTimers();
});

async function mountAction(Component, props) {
    const Root = defineComponent({
        setup: () => () =>
            h('div', [
                h(Component, typeof props === 'function' ? props() : props),
                h(ConfirmDialog),
            ]),
    });
    wrapper = mount(Root, { attachTo: document.body, global: { plugins: [i18n] } });
    await flushPromises();
}

describe('actions guarded by confirmation dialogs', () => {
    it('handles edit shortcuts before closing the group modal', async () => {
        const visible = ref(false);
        const rename = vi.fn();
        await mountAction(GroupManagementModal, () => ({
            show: visible.value,
            groups: ['Airport', 'Other'],
            onRename: rename,
            'onUpdate:show': (value) => {
                visible.value = value;
            },
        }));
        visible.value = true;
        await flushPromises();
        await click(document.querySelector('button[aria-label="Rename group"]'));
        const input = document.querySelector('input[aria-label="Rename group"]');
        input.value = 'New name';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        await flushPromises();
        expect(visible.value).toBe(true);
        expect(rename).not.toHaveBeenCalled();
        const trigger = document.querySelector('button[aria-label="Rename group"]');
        expect(document.activeElement).toBe(trigger);
        await click(trigger);
        const editor = document.querySelector('input[aria-label="Rename group"]');
        editor.value = 'Renamed';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
        );
        await flushPromises();
        expect(rename).toHaveBeenCalledExactlyOnceWith('Airport', 'Renamed');
        expect(visible.value).toBe(true);
        const renamedTrigger = document.querySelector('button[aria-label="Rename group"]');
        expect(document.activeElement).toBe(renamedTrigger);
        renamedTrigger.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
        await flushPromises();
        expect(visible.value).toBe(false);
    });
    it('clears logs only after approval and keeps the log modal open on cancellation', async () => {
        const parentClose = vi.fn();
        await mountAction(LogModal, { show: true, 'onUpdate:show': parentClose });
        await click(button('common.clear'));
        await click(confirmation().querySelector('button'));
        expect(mocks.del).not.toHaveBeenCalled();
        expect(parentClose).not.toHaveBeenCalled();
        await click(button('common.clear'));
        await click(confirmation().querySelectorAll('button')[1]);
        expect(mocks.del).toHaveBeenCalledExactlyOnceWith('/api/logs');
    });

    it('shows a cleanup warning while preserving the successful backup status', async () => {
        const settings = { webdavBackup: { ...DEFAULT_SETTINGS.webdavBackup, enabled: true } };
        mocks.post.mockResolvedValue({
            success: true,
            timestamp: '2026-11-11T04:00:00.000Z',
            file: '/MiSub/misub-backup-2026-11-11-12-00-00.json',
            message: '备份成功，但旧备份清理失败: HTTP 403',
            cleanup: { success: false, deleted: 0, message: 'HTTP 403' },
        });
        await mountAction(WebdavBackupSettings, { settings });
        await click(button('settings.webdavRunBackup'));
        await click(confirmation().querySelectorAll('button')[1]);
        expect(settings.webdavBackup.lastBackupStatus).toBe('success');
        expect(settings.webdavBackup.lastBackupMessage).toContain('HTTP 403');
        expect(mocks.showToast).toHaveBeenLastCalledWith(
            i18n.t('settings.webdavCleanupFailedWithMessage', { message: 'HTTP 403' }),
            'warning'
        );
    });

    it('restores a WebDAV file only after approval', async () => {
        vi.useFakeTimers();
        mocks.get.mockResolvedValue({
            success: true,
            data: [{ name: 'backup.json', path: '/MiSub/backup.json' }],
        });
        await mountAction(WebdavBackupSettings, {
            settings: {
                webdavBackup: { ...DEFAULT_SETTINGS.webdavBackup, enabled: true },
            },
        });
        await click(button('settings.webdavLoadRemote'));
        await click(button('settings.webdavRestore'));
        expect(useConfirmState().value.variant).toBe('danger');
        await click(confirmation().querySelector('button'));
        expect(mocks.post).not.toHaveBeenCalled();
        await click(button('settings.webdavRestore'));
        await click(confirmation().querySelectorAll('button')[1]);
        expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/api/backup/webdav/restore', {
            file: '/MiSub/backup.json',
        });
    });

    it('preserves a custom page when template replacement is cancelled', async () => {
        const settings = {
            customPage: {
                ...DEFAULT_SETTINGS.customPage,
                enabled: true,
                type: 'html',
                content: '<p>Original</p>',
                css: '',
            },
        };
        await mountAction(CustomPageSettings, { settings });
        await click(document.querySelector('[data-testid="custom-page-template"]'));
        await click(confirmation().querySelector('button'));
        expect(settings.customPage.content).toBe('<p>Original</p>');
        await click(document.querySelector('[data-testid="custom-page-template"]'));
        await click(confirmation().querySelectorAll('button')[1]);
        expect(settings.customPage.content).not.toBe('<p>Original</p>');
        expect(settings.customPage.allowScripts).toBe(false);
    });
});
