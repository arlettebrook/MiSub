<script setup>
    import { computed, ref, watch, defineAsyncComponent } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import SettingsLayout from '../layout/SettingsLayout.vue';
    import SettingsSidebar from './SettingsSidebar.vue';
    import SettingsSaveButton from './SettingsSaveButton.vue';
    import SettingsSectionLoading from './SettingsSectionLoading.vue';
    import { settingsSectionLoaders } from '../../utils/settings-section-loaders.js';

    // State belongs to the parent useSettingsLogic instance. This component
    // shares section rendering, lazy loading and actions across both shells.
    const props = defineProps({
        activeTab: { type: String, required: true },
        settings: { type: Object, required: true },
        disguiseConfig: { type: Object, default: () => ({}) },
        isLoading: Boolean,
        isSaving: Boolean,
        saveDisabled: Boolean,
        highlightedFocusId: String,
        alwaysShowHeader: Boolean,
        layoutClass: { type: String, default: 'h-full' },
        exportBackup: Function,
        importBackup: Function,
        handleReset: Function,
    });
    const emit = defineEmits([
        'update:activeTab',
        'save',
        'migrate',
        'section-mounted',
        'save-anchor',
    ]);
    const { t } = useI18n();
    const activeTabModel = computed({
        get: () => props.activeTab,
        set: (tab) => emit('update:activeTab', tab),
    });
    const visitedTabs = ref(new Set());
    const mountedSections = new Set();
    const resolvedSections = new Set();
    watch(
        () => props.activeTab,
        (tab) => visitedTabs.value.add(tab),
        { immediate: true, flush: 'sync' }
    );
    watch(
        () => props.isLoading,
        (loading) => {
            if (loading) mountedSections.clear();
        },
        { flush: 'sync' }
    );
    const handleSectionMounted = (tab) => {
        // Vue also mounts the async wrapper while its loading placeholder is
        // visible. Only signal readiness after the section code has resolved.
        if (!resolvedSections.has(tab)) return;
        mountedSections.add(tab);
        if (tab === 'system' || tab === 'webdav') {
            if (mountedSections.has('system') && mountedSections.has('webdav'))
                emit('section-mounted', 'system');
        } else emit('section-mounted', tab);
    };
    const setSaveAnchor = (element) => emit('save-anchor', element);
    const lazySection = (tab) =>
        defineAsyncComponent({
            loader: async () => {
                const section = await settingsSectionLoaders[tab]();
                resolvedSections.add(tab);
                return section.default || section;
            },
            loadingComponent: SettingsSectionLoading,
            delay: 0,
        });
    const BasicSettings = lazySection('basic');
    const HomeSettings = lazySection('home');
    const ServiceSettings = lazySection('service');
    const GlobalSettings = lazySection('global');
    const SystemSettings = lazySection('system');
    const WebdavBackupSettings = lazySection('webdav');
    const ClientSettings = lazySection('client');
    const CustomPageSettings = lazySection('custom-page');
    const currentTabLabel = computed(() => {
        switch (props.activeTab) {
            case 'basic':
                return t('settings.tabs.basic');
            case 'home':
                return t('settings.tabs.home');
            case 'global':
                return t('settings.tabs.global');
            case 'service':
                return t('settings.tabs.service');

            case 'client':
                return t('settings.tabs.client');
            case 'system':
                return t('settings.tabs.system');
            case 'custom-page':
                return t('settings.tabs.customPage');
            default:
                return t('settings.title');
        }
    });
</script>

<template>
    <SettingsLayout :class="layoutClass">
        <template #sidebar>
            <SettingsSidebar v-model:activeTab="activeTabModel" />
        </template>

        <div v-if="isLoading" class="text-center p-12" role="status" aria-live="polite">
            <svg
                class="animate-spin h-8 w-8 text-indigo-500 mx-auto mb-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
            >
                <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                ></circle>
                <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
            </svg>
            <p class="text-gray-500">{{ t('settings.loading') }}</p>
        </div>

        <div v-else class="space-y-6 max-w-6xl w-full mx-auto">
            <div
                :class="alwaysShowHeader ? 'flex' : 'hidden md:flex'"
                class="flex-wrap items-center justify-between gap-3 p-4 bg-white/70 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg shadow-sm"
            >
                <div>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                        {{ t('settings.currentModule') }}
                    </p>
                    <p class="text-lg font-semibold text-gray-900 dark:text-white">
                        {{ currentTabLabel }}
                    </p>
                </div>
                <div
                    class="text-xs text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-white/5 border border-gray-200/60 dark:border-white/10 px-3 py-1.5 misub-radius-pill"
                >
                    {{ t('settings.saveHint') }}
                </div>
            </div>
            <BasicSettings
                v-if="visitedTabs.has('basic')"
                v-show="activeTab === 'basic'"
                :settings="settings"
                :disguiseConfig="disguiseConfig"
                :highlighted-focus-id="highlightedFocusId"
                @vue:mounted="handleSectionMounted('basic')"
            />
            <HomeSettings
                v-if="visitedTabs.has('home')"
                v-show="activeTab === 'home'"
                :settings="settings"
                @vue:mounted="handleSectionMounted('home')"
            />
            <GlobalSettings
                v-if="visitedTabs.has('global')"
                v-show="activeTab === 'global'"
                :settings="settings"
                @vue:mounted="handleSectionMounted('global')"
            />
            <ServiceSettings
                v-if="visitedTabs.has('service')"
                v-show="activeTab === 'service'"
                :settings="settings"
                @vue:mounted="handleSectionMounted('service')"
            />
            <ClientSettings
                v-if="visitedTabs.has('client')"
                v-show="activeTab === 'client'"
                @vue:mounted="handleSectionMounted('client')"
            />
            <CustomPageSettings
                v-if="visitedTabs.has('custom-page')"
                v-show="activeTab === 'custom-page'"
                :settings="settings"
                @vue:mounted="handleSectionMounted('custom-page')"
            />
            <div v-if="visitedTabs.has('system')" v-show="activeTab === 'system'" class="space-y-6">
                <WebdavBackupSettings
                    :settings="settings"
                    @vue:mounted="handleSectionMounted('webdav')"
                />
                <SystemSettings
                    :settings="settings"
                    :exportBackup="exportBackup"
                    :importBackup="importBackup"
                    :handleReset="handleReset"
                    @migrate="$emit('migrate')"
                    @vue:mounted="handleSectionMounted('system')"
                />
            </div>
        </div>

        <template #footer>
            <div :ref="setSaveAnchor">
                <SettingsSaveButton
                    :is-saving="isSaving"
                    :disabled="saveDisabled || isLoading"
                    @save="$emit('save')"
                />
            </div>
        </template>
    </SettingsLayout>
</template>
