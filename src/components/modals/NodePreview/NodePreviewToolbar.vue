<script setup>
    import { useI18n } from '../../../i18n/index.js';

    defineProps({
        title: String,
        subtitle: String,
        profile: Boolean,
        loading: Boolean,
        refreshing: Boolean,
        pickingMode: Boolean,
    });
    const emit = defineEmits(['refresh', 'close', 'update:pickingMode']);
    const { t } = useI18n();
</script>

<template>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between px-2">
        <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2">
                <div class="w-1.5 h-6 bg-indigo-600 rounded-full"></div>
                <h3
                    class="truncate text-lg font-black text-gray-900 dark:text-white sm:text-2xl tracking-tight"
                >
                    {{ title }}
                </h3>
            </div>
            <p
                class="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-widest pl-3.5"
            >
                {{ subtitle }}
            </p>
        </div>
        <div class="flex items-center gap-3 self-end sm:self-auto">
            <button
                @click="emit('refresh')"
                :disabled="loading"
                :aria-label="t('nodePreview.refreshNodes')"
                :aria-busy="refreshing"
                class="flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-wait disabled:opacity-50 dark:bg-gray-700/50 dark:text-gray-300"
            >
                <svg
                    class="h-4 w-4"
                    :class="{ 'animate-spin': refreshing }"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 4v5h5m11 11v-5h-5M5.5 15a7 7 0 0011.7 3L20 15M4 9l2.8-3A7 7 0 0118.5 9"
                    />
                </svg>
                {{ refreshing ? t('nodePreview.refreshingNodes') : t('common.refresh') }}
            </button>
            <button
                v-if="profile"
                @click="emit('update:pickingMode', !pickingMode)"
                :disabled="loading"
                class="px-4 py-2 text-xs font-bold rounded-xl transition-all shadow-sm active:scale-95"
                :class="
                    pickingMode
                        ? 'bg-indigo-600 text-white shadow-indigo-500/20'
                        : 'bg-gray-100 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300 hover:bg-gray-200'
                "
            >
                {{ pickingMode ? t('nodePreview.exitPicking') : t('nodePreview.pickNodes') }}
            </button>
            <button
                @click="emit('close')"
                class="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
                :aria-label="t('common.close')"
            >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2.5"
                        d="M6 18L18 6M6 6l12 12"
                    ></path>
                </svg>
            </button>
        </div>
    </div>
</template>
