<script setup>
    import { ref, onMounted, computed } from 'vue';
    import { createLazyModal } from '../../utils/lazy-modal.js';
    import { useLazyModals } from '../../composables/useLazyModals.js';
    import { useSettingsLogic } from '../../composables/useSettingsLogic.js';
    import SettingsContent from '../settings/SettingsContent.vue';

    const props = defineProps({
        exportBackup: Function,
        importBackup: Function,
        sessionPaused: Boolean,
    });
    const {
        settings,
        disguiseConfig,
        isLoading,
        isSaving,
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
    const activeTab = ref('basic');
    const MigrationModal = createLazyModal('MigrationModal');
    const mountedModals = useLazyModals({ migration: showMigrationModal });
    const isSaveDisabled = computed(
        () =>
            props.sessionPaused ||
            isLoading.value ||
            isSaving.value ||
            hasWhitespace.value ||
            !isStorageTypeValid.value
    );
    const handleSaveAndReturnStatus = () =>
        isSaveDisabled.value ? Promise.resolve(false) : handleSave();
    onMounted(loadSettings);
    defineExpose({ handleSave: handleSaveAndReturnStatus });
</script>

<template>
    <div
        class="w-full h-full min-h-[520px] overflow-hidden bg-white/50 dark:bg-gray-900/50 misub-radius-lg"
    >
        <SettingsContent
            v-model:active-tab="activeTab"
            :settings="settings"
            :disguise-config="disguiseConfig"
            :is-loading="isLoading"
            :is-saving="isSaving"
            :save-disabled="isSaveDisabled"
            always-show-header
            layout-class="h-full !shadow-none !border-0 !rounded-none !bg-transparent"
            :export-backup="props.exportBackup || exportBackup"
            :import-backup="props.importBackup || importBackup"
            :handle-reset="handleReset"
            @save="handleSaveAndReturnStatus"
            @migrate="showMigrationModal = true"
        />
        <MigrationModal
            v-if="mountedModals.has('migration')"
            v-model:show="showMigrationModal"
            @success="handleMigrationSuccess"
        />
    </div>
</template>
