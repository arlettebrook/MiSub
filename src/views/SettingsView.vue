<script setup>
    import { ref, computed, nextTick, onMounted, onActivated, onBeforeUnmount, watch } from 'vue';
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
    import { resolveSettingsFocusAnchor } from '../utils/dashboard-deeplink.js';

    const props = defineProps({ sessionPaused: Boolean });

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
    const settingsTabStorageKey = 'misub:settings-active-tab';
    const settingsTabIds = new Set([
        'basic',
        'home',
        'custom-page',
        'global',
        'service',
        'client',
        'system',
    ]);
    const restoreActiveTab = () => {
        try {
            const savedTab = sessionStorage.getItem(settingsTabStorageKey);
            return settingsTabIds.has(savedTab) ? savedTab : 'basic';
        } catch {
            return 'basic';
        }
    };
    const activeTab = ref(restoreActiveTab());
    watch(
        activeTab,
        (tab) => {
            try {
                sessionStorage.setItem(settingsTabStorageKey, tab);
            } catch {
                // Tab switching still works when browser storage is unavailable.
            }
        },
        { flush: 'sync' }
    );
    const route = useRoute();
    const emit = defineEmits(['content-ready']);
    const settingsRoutePath = route.path;
    const settingsPage = ref(null);
    const highlightedFocusId = ref('');
    watch(
        [() => route.path, () => route.query?.focus, isLoading],
        async ([path, focus, loading]) => {
            if (path !== settingsRoutePath) return;
            const anchor = resolveSettingsFocusAnchor(focus);
            highlightedFocusId.value = anchor;
            if (!anchor) return;
            activeTab.value = 'basic';
            if (loading) return;
            await nextTick();
            if (
                highlightedFocusId.value !== anchor ||
                route.path !== settingsRoutePath ||
                isLoading.value
            )
                return;
            settingsPage.value?.querySelector(`#${anchor}`)?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'center',
            });
        },
        { immediate: true }
    );
    const bottomSaveAction = ref(null);
    const isBottomSaveVisible = ref(true);
    const floatingSaveHeaderBottom = ref(0);
    const floatingSaveViewportTop = ref(0);
    const isSaveDisabled = computed(
        () =>
            props.sessionPaused ||
            isLoading.value ||
            isSaving.value ||
            hasWhitespace.value ||
            !isStorageTypeValid.value
    );
    const showFloatingSave = computed(
        () =>
            !props.sessionPaused &&
            hasUnsavedChanges.value &&
            !isLoading.value &&
            !isBottomSaveVisible.value
    );
    let saveVisibilityObserver;
    let saveVisibilityRootMargin;
    let saveVisualViewport;
    let saveViewportFrame = null;
    let mobileSaveHeaderHeight = 0;

    const observeBottomSave = () => {
        const button = bottomSaveAction.value;
        if (!button) return;

        // A mobile keyboard can resize and pan the visual viewport without resizing the window.
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportBottom = Math.min(
            window.innerHeight,
            viewportTop + (viewport?.height || window.innerHeight)
        );
        const headerRects = Array.from(document.querySelectorAll('.app-nav-bar')).map((header) =>
            header.getBoundingClientRect()
        );
        const headerBottom = Math.max(viewportTop, ...headerRects.map((rect) => rect.bottom));
        const isMobile = window.matchMedia('(width < 48rem)').matches;
        if (isMobile) {
            const headerHeight = Math.max(0, ...headerRects.map((rect) => rect.height));
            if (headerHeight > 0) mobileSaveHeaderHeight = headerHeight;
        }
        const mobileNavRect = document.querySelector('.mobile-nav-glass')?.getBoundingClientRect();
        const visibleBottom =
            mobileNavRect?.height > 0
                ? Math.min(viewportBottom, mobileNavRect.top)
                : viewportBottom;
        const bottomInset = Math.max(0, window.innerHeight - visibleBottom);
        // Reserve the mobile header's space even while it scrolls out of the visual viewport.
        // Panning then changes only the compositor translation, rather than the button's top edge.
        floatingSaveHeaderBottom.value = isMobile ? mobileSaveHeaderHeight : headerBottom;
        floatingSaveViewportTop.value = isMobile ? viewportTop : 0;
        const rootMargin = `-${headerBottom}px 0px -${bottomInset}px 0px`;
        if (saveVisibilityObserver && saveVisibilityRootMargin === rootMargin) return;

        saveVisibilityObserver?.disconnect();
        const rect = button.getBoundingClientRect();
        isBottomSaveVisible.value =
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > headerBottom &&
            rect.top < visibleBottom;

        if (typeof IntersectionObserver === 'undefined') return;
        saveVisibilityRootMargin = rootMargin;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (saveVisibilityObserver !== observer) return;
                isBottomSaveVisible.value = entry.isIntersecting;
            },
            { rootMargin }
        );
        saveVisibilityObserver = observer;
        saveVisibilityObserver.observe(button);
    };

    const scheduleSaveViewportUpdate = () => {
        if (saveViewportFrame !== null) return;
        saveViewportFrame = window.requestAnimationFrame(() => {
            saveViewportFrame = null;
            observeBottomSave();
        });
    };

    watch(
        bottomSaveAction,
        () => {
            saveVisibilityObserver?.disconnect();
            saveVisibilityObserver = undefined;
            observeBottomSave();
        },
        { flush: 'post' }
    );

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
        window.addEventListener('resize', scheduleSaveViewportUpdate);
        window.addEventListener('scroll', scheduleSaveViewportUpdate, { passive: true });
        saveVisualViewport = window.visualViewport;
        saveVisualViewport?.addEventListener('resize', scheduleSaveViewportUpdate);
        saveVisualViewport?.addEventListener('scroll', scheduleSaveViewportUpdate, {
            passive: true,
        });
    });

    onBeforeUnmount(() => {
        saveVisibilityObserver?.disconnect();
        saveVisibilityObserver = undefined;
        if (saveViewportFrame !== null) window.cancelAnimationFrame(saveViewportFrame);
        window.removeEventListener('resize', scheduleSaveViewportUpdate);
        window.removeEventListener('scroll', scheduleSaveViewportUpdate);
        saveVisualViewport?.removeEventListener('resize', scheduleSaveViewportUpdate);
        saveVisualViewport?.removeEventListener('scroll', scheduleSaveViewportUpdate);
    });

    onActivated(() => {
        loadPageSettings();
    });

    watch(
        () => route.path,
        (path) => {
            if (path === settingsRoutePath) {
                loadPageSettings();
            }
        }
    );
</script>

<template>
    <div ref="settingsPage" class="pt-0 md:min-h-[calc(100vh-80px)]">
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
                    :highlighted-focus-id="highlightedFocusId"
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
                :style="{
                    '--settings-header-bottom': `${floatingSaveHeaderBottom}px`,
                    '--settings-viewport-top': `${floatingSaveViewportTop}px`,
                }"
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
        transform: translate3d(0, var(--settings-viewport-top, 0px), 0);
        z-index: 30;
        box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
        transition-property: background-color, box-shadow, scale, opacity;
    }

    @media (width >= 48rem) {
        .settings-floating-save {
            top: calc(var(--settings-header-bottom, 0px) + 1.75rem);
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
