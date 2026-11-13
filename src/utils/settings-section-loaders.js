import { cachedLoader } from './load-timing.js';

const imports = {
    basic: () => import('../components/settings/sections/BasicSettings.vue'),
    home: () => import('../components/settings/sections/HomeSettings.vue'),
    service: () => import('../components/settings/sections/ServiceSettings.vue'),
    global: () => import('../components/settings/sections/GlobalSettings.vue'),
    system: () => import('../components/settings/sections/SystemSettings.vue'),
    webdav: () => import('../components/settings/sections/WebdavBackupSettings.vue'),
    client: () => import('../components/settings/sections/ClientSettings.vue'),
    'custom-page': () => import('../components/settings/sections/CustomPageSettings.vue'),
};
export const settingsSectionLoaders = Object.fromEntries(
    Object.entries(imports).map(([tab, load]) => [
        tab,
        cachedLoader(`misub:code:settings:${tab}`, load),
    ])
);

export function preferredSettingsTab() {
    try {
        const saved = sessionStorage.getItem('misub:settings-active-tab');
        if (saved && saved !== 'webdav' && Object.hasOwn(settingsSectionLoaders, saved))
            return saved;
    } catch {
        // Storage is optional.
    }
    return 'basic';
}

export async function preloadPreferredSettingsSection() {
    const tab = preferredSettingsTab();
    await settingsSectionLoaders[tab]();
    if (tab === 'system') await settingsSectionLoaders.webdav();
}
