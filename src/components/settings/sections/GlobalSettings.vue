<script setup>
    import NodeFlagSettings from '../NodeFlagSettings.vue';
    import RegionOverrideSettings from '../RegionOverrideSettings.vue';
    import { watch } from 'vue';
    import OperatorChain from '../../features/Operators/OperatorChain.vue';
    import SectionHeader from '../SectionHeader.vue';
    import { useI18n } from '../../../i18n/index.js';

    const { t } = useI18n();

    const props = defineProps({
        settings: {
            type: Object,
            required: true,
        },
    });

    const prefixToggleOptions = [
        { labelKey: 'profiles.optionEnabled', value: true },
        { labelKey: 'profiles.optionDisabled', value: false },
    ];

    const buildDefaultPrefixSettings = () => ({
        enableManualNodes: true,
        enableSubscriptions: true,
        manualNodePrefix: 'Manual Node',
        prependGroupName: false,
    });

    function ensureDefaults() {
        if (!props.settings) return;

        if (!props.settings.defaultPrefixSettings) {
            props.settings.defaultPrefixSettings = buildDefaultPrefixSettings();
        }

        if (!Array.isArray(props.settings.defaultOperators)) {
            props.settings.defaultOperators = [];
        }

        if (!Array.isArray(props.settings.regionOverrides)) {
            props.settings.regionOverrides = [];
        }
    }
    watch(() => props.settings, ensureDefaults, { immediate: true });
</script>

<template>
    <div class="space-y-8">
        <!-- Announcement & Info Section -->
        <div
            class="rounded-xl border border-indigo-100 bg-indigo-50/50 p-6 shadow-sm dark:border-indigo-500/10 dark:bg-indigo-900/10"
        >
            <SectionHeader
                :title="t('settings.globalInfoTitle')"
                :description="t('settings.globalInfoDesc')"
                tone="indigo"
            >
                <template #icon>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                </template>
            </SectionHeader>
            <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {{ t('settings.globalInfoBody') }}
            </p>
        </div>

        <!-- Node Prefix Settings -->
        <div
            class="rounded-xl border border-gray-100 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-gray-900/70"
        >
            <SectionHeader
                :title="t('settings.globalNodeSettingsTitle')"
                :description="t('settings.globalNodeSettingsDesc')"
                tone="blue"
            >
                <template #icon>
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 6h16M4 12h16M4 18h16"
                        />
                    </svg>
                </template>
            </SectionHeader>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
                <!-- 第一排：手动节点文本前缀 与 开关 -->
                <div>
                    <Input
                        v-model="settings.defaultPrefixSettings.manualNodePrefix"
                        :label="t('settings.globalManualNodePrefix')"
                    />
                </div>

                <div>
                    <label
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 ml-1"
                        >{{ t('settings.globalManualNodePrefixSwitch') }}</label
                    >
                    <div class="relative">
                        <select
                            v-model="settings.defaultPrefixSettings.enableManualNodes"
                            class="w-full bg-gray-50 dark:bg-gray-800 border border-transparent dark:border-gray-700 misub-radius-md py-2.5 px-4 text-xs text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:outline-none transition-all appearance-none"
                        >
                            <option
                                v-for="option in prefixToggleOptions"
                                :key="String(option.value)"
                                :value="option.value"
                            >
                                {{ t(option.labelKey) }}
                            </option>
                        </select>
                        <div
                            class="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-500 dark:text-gray-400"
                        >
                            <svg
                                class="w-3.5 h-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>

                <!-- 第二排：机场订阅前缀 与 节点国旗 EMOJI -->
                <div>
                    <label
                        class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 ml-1"
                        >{{ t('settings.globalSubscriptionPrefixSwitch') }}</label
                    >
                    <div class="relative">
                        <select
                            v-model="settings.defaultPrefixSettings.enableSubscriptions"
                            class="w-full bg-gray-50 dark:bg-gray-800 border border-transparent dark:border-gray-700 misub-radius-md py-2 px-4 text-sm text-gray-900 dark:text-white focus-visible:ring-2 focus-visible:ring-blue-500/20 focus-visible:outline-none transition-all appearance-none"
                        >
                            <option
                                v-for="option in prefixToggleOptions"
                                :key="String(option.value)"
                                :value="option.value"
                            >
                                {{ t(option.labelKey) }}
                            </option>
                        </select>
                        <div
                            class="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-gray-500 dark:text-gray-400"
                        >
                            <svg
                                class="w-3.5 h-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                </div>

                <NodeFlagSettings :model="settings" />
            </div>
        </div>

        <!-- Region Overrides -->
        <div
            class="rounded-xl border border-gray-100 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-gray-900/70"
        >
            <RegionOverrideSettings :model="settings" />
        </div>

        <!-- Unified Operator Chain -->
        <div
            class="rounded-xl border border-gray-100 bg-white/90 p-6 shadow-sm dark:border-white/10 dark:bg-gray-900/70"
        >
            <div class="flex items-start justify-between gap-3">
                <SectionHeader
                    :title="t('settings.globalDefaultOperatorsTitle')"
                    :description="t('settings.globalDefaultOperatorsDesc')"
                    tone="green"
                >
                    <template #icon>
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M4 6h16M4 10h16M4 14h10M4 18h6"
                            />
                        </svg>
                    </template>
                </SectionHeader>
                <span
                    class="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-500/15 dark:text-green-300"
                    >{{ t('settings.globalDefaultBadge') }}</span
                >
            </div>

            <OperatorChain
                v-model="settings.defaultOperators"
                :legacy-data="settings.defaultNodeTransform"
            />
        </div>
    </div>
</template>
