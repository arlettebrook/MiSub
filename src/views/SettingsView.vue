<script setup>
    import { ref, computed, onMounted, onActivated, onBeforeUnmount, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import { useI18n } from '../i18n/index.js';
    import MigrationModal from '../components/modals/MigrationModal.vue';
    import { useSettingsLogic } from '../composables/useSettingsLogic.js';
    import SettingsLayout from '../components/layout/SettingsLayout.vue';

    import SettingsSidebar from '../components/settings/SettingsSidebar.vue';
    import SettingsSaveButton from '../components/settings/SettingsSaveButton.vue';
    import BasicSettings from '../components/settings/sections/BasicSettings.vue';
    import HomeSettings from '../components/settings/sections/HomeSettings.vue';
    import ServiceSettings from '../components/settings/sections/ServiceSettings.vue';
    import GlobalSettings from '../components/settings/sections/GlobalSettings.vue';

    import SystemSettings from '../components/settings/sections/SystemSettings.vue';
    import WebdavBackupSettings from '../components/settings/sections/WebdavBackupSettings.vue';
    import ClientSettings from '../components/settings/sections/ClientSettings.vue';
    import CustomPageSettings from '../components/settings/sections/CustomPageSettings.vue';

    // 使用 composable 获取所有设置相关的状态和函数
    const { t } = useI18n();

    const {
        settings,
        disguiseConfig,
        isLoading,
        isSaving,
        hasUnsavedChanges,
        showMigrationModal,
        hasWhitespace,
        isStorageTypeValid,
        loadSettings,
        handleSave,
        handleMigrationSuccess,
        handleReset,
        exportBackup,
        importBackup,
    } = useSettingsLogic();

    // 仅新布局需要的状态
    const activeTab = ref('basic');
    const route = useRoute();
    const emit = defineEmits(['content-ready']);
    const settingsRoutePath = route.path;
    const bottomSaveAction = ref(null);
    const isBottomSaveVisible = ref(true);
    const floatingSaveHeaderBottom = ref(0);
    const isSaveDisabled = computed(
        () => isLoading.value || isSaving.value || hasWhitespace.value || !isStorageTypeValid.value
    );
    const showFloatingSave = computed(
        () => hasUnsavedChanges.value && !isLoading.value && !isBottomSaveVisible.value
    );
    let saveVisibilityObserver;

    const observeBottomSave = () => {
        saveVisibilityObserver?.disconnect();
        const button = bottomSaveAction.value;
        if (!button) return;

        const headerBottom = Math.max(
            0,
            ...Array.from(document.querySelectorAll('.app-nav-bar')).map(
                (header) => header.getBoundingClientRect().bottom
            )
        );
        const mobileNavHeight =
            document.querySelector('.mobile-nav-glass')?.getBoundingClientRect().height || 0;
        floatingSaveHeaderBottom.value = headerBottom;
        const rect = button.getBoundingClientRect();
        isBottomSaveVisible.value =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > headerBottom &&
            rect.top < window.innerHeight - mobileNavHeight;

        if (typeof IntersectionObserver === 'undefined') return;
        saveVisibilityObserver = new IntersectionObserver(
            ([entry]) => {
                isBottomSaveVisible.value = entry.isIntersecting;
            },
            { rootMargin: `-${headerBottom}px 0px -${mobileNavHeight}px 0px` }
        );
        saveVisibilityObserver.observe(button);
    };

    watch(bottomSaveAction, observeBottomSave, { flush: 'post' });

    const loadPageSettings = async () => {
        await loadSettings();
        emit('content-ready', settingsRoutePath);
    };

    const currentTabLabel = computed(() => {
        switch (activeTab.value) {
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

    // 仅新布局需要的函数
    const handleOpenMigrationModal = () => {
        showMigrationModal.value = true;
    };

    // 备份函数已由 composable 提供

    onMounted(() => {
        loadPageSettings();
        window.addEventListener('resize', observeBottomSave);
    });

    onBeforeUnmount(() => {
        saveVisibilityObserver?.disconnect();
        window.removeEventListener('resize', observeBottomSave);
    });

    onActivated(() => {
        loadPageSettings();
    });

    watch(
        () => route.path,
        (path) => {
            if (path === '/settings') {
                activeTab.value = 'basic';
                loadPageSettings();
            }
        }
    );
</script>

<template>
    <div class="pt-0 md:min-h-[calc(100vh-80px)]">
        <div
            class="mb-4 bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4"
        >
            <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
                {{ t('settings.title') }}
            </h1>
        </div>

        <SettingsLayout class="settings-page-layout h-full">
            <template #sidebar>
                <SettingsSidebar v-model:activeTab="activeTab" />
            </template>

            <div v-if="isLoading" class="text-center p-12">
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
                    class="hidden md:flex flex-wrap items-center justify-between gap-3 p-4 bg-white/70 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg shadow-sm"
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
                    v-show="activeTab === 'basic'"
                    :settings="settings"
                    :disguiseConfig="disguiseConfig"
                />
                <HomeSettings v-show="activeTab === 'home'" :settings="settings" />
                <GlobalSettings v-show="activeTab === 'global'" :settings="settings" />
                <ServiceSettings v-show="activeTab === 'service'" :settings="settings" />
                <ClientSettings v-show="activeTab === 'client'" />
                <CustomPageSettings v-show="activeTab === 'custom-page'" :settings="settings" />
                <div v-show="activeTab === 'system'" class="space-y-6">
                    <WebdavBackupSettings :settings="settings" />
                    <SystemSettings
                        :settings="settings"
                        :exportBackup="exportBackup"
                        :importBackup="importBackup"
                        :handleReset="handleReset"
                        @migrate="handleOpenMigrationModal"
                    />
                </div>
            </div>

            <template #footer>
                <div ref="bottomSaveAction">
                    <SettingsSaveButton
                        :is-saving="isSaving"
                        :disabled="isSaveDisabled"
                        @save="handleSave"
                    />
                </div>
            </template>
        </SettingsLayout>

        <Teleport to="body">
            <SettingsSaveButton
                v-if="showFloatingSave"
                class="settings-floating-save"
                :style="{ '--settings-header-bottom': `${floatingSaveHeaderBottom}px` }"
                :is-saving="isSaving"
                :disabled="isSaveDisabled"
                @save="handleSave"
            />
        </Teleport>

        <!-- Modals -->
        <MigrationModal v-model:show="showMigrationModal" @success="handleMigrationSuccess" />
    </div>
</template>

<style scoped>
    .settings-floating-save {
        position: fixed;
        top: calc(var(--settings-header-bottom, 0px) + 1.5rem);
        right: max(1rem, env(safe-area-inset-right, 0px));
        z-index: 30;
        box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
    }

    @media (width >= 48rem) {
        .settings-floating-save {
            top: calc(var(--settings-header-bottom, 0px) + 2rem);
            right: max(1.5rem, calc((100vw - 80rem) / 2 + 2rem));
        }
    }

    /* Keep the page save action at the end of the form on every screen size. */
    .settings-page-layout :deep(.settings-layout-footer) {
        position: static;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }
</style>
