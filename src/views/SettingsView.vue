<script setup>
    import { createLazyModal } from '../utils/lazy-modal.js';
    import { ref, computed, nextTick, onMounted, onActivated, onBeforeUnmount, watch } from 'vue';
    import { useRoute } from 'vue-router';
    import { useI18n } from '../i18n/index.js';
    import { useLazyModals } from '../composables/useLazyModals.js';
    import { useSettingsLogic } from '../composables/useSettingsLogic.js';

    import SettingsContent from '../components/settings/SettingsContent.vue';
    import SettingsSaveButton from '../components/settings/SettingsSaveButton.vue';

    import { resolveSettingsFocusAnchor } from '../utils/dashboard-deeplink.js';
    import { createFloatingSavePosition } from '../utils/floating-save-position.js';

    const MigrationModal = createLazyModal('MigrationModal');

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
    const mountedModals = useLazyModals({ migration: showMigrationModal });

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

    const mountedTabs = new Set();
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
    const focusHighlightedSetting = async () => {
        const anchor = highlightedFocusId.value;
        if (!anchor || isLoading.value || route.path !== settingsRoutePath) return;
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
    };
    watch(
        [() => route.path, () => route.query?.focus, isLoading],
        ([path, focus]) => {
            if (path !== settingsRoutePath) return;
            const anchor = resolveSettingsFocusAnchor(focus);
            highlightedFocusId.value = anchor;
            if (!anchor) return;
            activeTab.value = 'basic';
            void focusHighlightedSetting();
        },
        { immediate: true }
    );

    const notifyContentReady = () => {
        if (!isLoading.value && mountedTabs.has(activeTab.value)) {
            emit('content-ready', settingsRoutePath);
        }
    };
    const handleSectionMounted = (tab) => {
        mountedTabs.add(tab);
        if (tab === 'basic') void focusHighlightedSetting();
        notifyContentReady();
    };
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
    const floatingSavePosition = createFloatingSavePosition();

    const observeBottomSave = (timestamp) => {
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
        const mobileNavRect = document.querySelector('.mobile-nav-glass')?.getBoundingClientRect();
        const visibleBottom =
            mobileNavRect?.height > 0
                ? Math.min(viewportBottom, mobileNavRect.top)
                : viewportBottom;
        const bottomInset = Math.max(0, window.innerHeight - visibleBottom);
        if (isMobile) {
            const position = floatingSavePosition.update({
                headerHeight: headerBottom - viewportTop,
                viewportTop,
                timestamp,
                devicePixelRatio: window.devicePixelRatio,
                animate:
                    Number.isFinite(timestamp) &&
                    showFloatingSave.value &&
                    !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            });
            floatingSaveHeaderBottom.value = position.headerOffset;
            floatingSaveViewportTop.value = position.viewportTop;
            if (position.needsAnimation) scheduleSaveViewportUpdate();
        } else {
            floatingSaveHeaderBottom.value = headerBottom;
            floatingSaveViewportTop.value = 0;
        }
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
        saveViewportFrame = window.requestAnimationFrame((timestamp) => {
            saveViewportFrame = null;
            observeBottomSave(timestamp);
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
        notifyContentReady();
    };

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

        <SettingsContent
            v-model:active-tab="activeTab"
            :settings="settings"
            :disguise-config="disguiseConfig"
            :is-loading="isLoading"
            :is-saving="isSaving"
            :save-disabled="isSaveDisabled"
            :highlighted-focus-id="highlightedFocusId"
            layout-class="settings-page-layout h-full"
            :export-backup="exportBackup"
            :import-backup="importBackup"
            :handle-reset="handleReset"
            @save="handleSave"
            @migrate="handleOpenMigrationModal"
            @section-mounted="handleSectionMounted"
            @save-anchor="bottomSaveAction = $event"
        />

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
        <MigrationModal
            v-if="mountedModals.has('migration')"
            v-model:show="showMigrationModal"
            @success="handleMigrationSuccess"
        />
    </div>
</template>

<style scoped>
    .settings-floating-save {
        position: fixed;
        top: 1.5rem;
        right: max(1rem, env(safe-area-inset-right, 0px));
        transform: translate3d(
            0,
            calc(var(--settings-viewport-top, 0px) + var(--settings-header-bottom, 0px)),
            0
        );
        z-index: 30;
        box-shadow: 0 4px 16px rgb(0 0 0 / 15%);
        transition-property: background-color, box-shadow, scale, opacity;
        transition-duration: 160ms;
        transition-timing-function: ease-out;
    }

    @media (width >= 48rem) {
        .settings-floating-save {
            top: calc(var(--settings-header-bottom, 0px) + 1.75rem);
            right: max(1.5rem, calc((100vw - 80rem) / 2 + 2rem));
            transform: none;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .settings-floating-save {
            transition-duration: 0ms;
        }
    }

    /* Keep the page save action at the end of the form on every screen size. */
    .settings-page-layout :deep(.settings-layout-footer) {
        position: static;
        backdrop-filter: none;
        -webkit-backdrop-filter: none;
    }
</style>
