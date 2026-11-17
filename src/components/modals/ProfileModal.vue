<script setup>
    import {
        countryCodeMap,
        matchesManualNodeSearch,
    } from '../../composables/manual-nodes/filters.js';
    import { isRemoteSubscriptionSource } from '../../../shared/node-source.js';

    import { ref, watch, computed } from 'vue';
    import Modal from '../forms/Modal.vue';
    import ProfileForm from './ProfileModal/ProfileForm.vue';
    import SubscriptionSelector from './ProfileModal/SubscriptionSelector.vue';
    import NodeSelector from './ProfileModal/NodeSelector.vue';
    import { useManualNodes } from '../../composables/useManualNodes.js';
    import { useDataStore } from '../../stores/useDataStore.js';
    import { useSettingsStore } from '../../stores/settings.js';
    import { useI18n } from '@/i18n/index.js';

    const { t } = useI18n();
    const dataStore = useDataStore();
    const settingsStore = useSettingsStore();
    const { manualNodeGroups } = useManualNodes(dataStore.markDirty);

    const props = defineProps({
        show: Boolean,
        profile: Object,
        isNew: Boolean,
        allSubscriptions: Array,
        allManualNodes: Array,
    });

    const emit = defineEmits(['update:show', 'save']);

    const localProfile = ref({});
    const subscriptionSearchTerm = ref('');
    const nodeSearchTerm = ref('');
    const activeManualNodeGroupFilter = ref(null);
    const showAdvanced = ref(false);
    const uiText = computed(() => ({
        prefixTitle: t('profileModal.nodeNameVisibility'),
        manualPrefixLabel: t('profileModal.manualPrefixText'),
        manualPrefixToggle: t('profileModal.manualNodeDisplay'),
        subscriptionPrefixToggle: t('profileModal.subscriptionPrefix'),
        enable: t('profiles.optionEnabled'),
        disable: t('profiles.optionDisabled'),
    }));
    const prefixToggleOptions = [
        { label: t('profiles.globalDefault'), value: null },
        { label: t('profiles.optionEnabled'), value: true },
        { label: t('profiles.optionDisabled'), value: false },
    ];

    const groupPrefixToggleOptions = [
        { label: t('profiles.globalDefault'), value: null },
        { label: t('profiles.optionEnabled'), value: true },
        { label: t('profiles.optionDisabled'), value: false },
    ];

    const selectableSubscriptions = computed(() => {
        return (props.allSubscriptions || []).filter(
            (sub) => sub.enabled && isRemoteSubscriptionSource(sub)
        );
    });

    const filteredSubscriptions = computed(() => {
        const validSubs = selectableSubscriptions.value;

        if (!subscriptionSearchTerm.value) {
            return validSubs;
        }
        const lowerCaseSearchTerm = subscriptionSearchTerm.value.toLowerCase();
        const alternativeTerms = countryCodeMap[lowerCaseSearchTerm] || [];

        return validSubs.filter((sub) => {
            const subNameLower = sub.name ? sub.name.toLowerCase() : '';

            if (subNameLower.includes(lowerCaseSearchTerm)) {
                return true;
            }

            for (const altTerm of alternativeTerms) {
                if (subNameLower.includes(altTerm.toLowerCase())) {
                    return true;
                }
            }
            return false;
        });
    });

    const filteredManualNodes = computed(() => {
        let nodes = props.allManualNodes;

        if (activeManualNodeGroupFilter.value) {
            if (activeManualNodeGroupFilter.value === '默认') {
                nodes = nodes.filter((n) => !n.group);
            } else {
                nodes = nodes.filter((n) => n.group === activeManualNodeGroupFilter.value);
            }
        }

        if (!nodeSearchTerm.value) {
            return nodes;
        }
        return nodes.filter((node) => matchesManualNodeSearch(node.name, nodeSearchTerm.value));
    });

    watch(
        () => props.profile,
        (newProfile) => {
            if (newProfile) {
                const profileCopy = JSON.parse(JSON.stringify(newProfile));
                // Format date for input[type=date]
                if (profileCopy.expiresAt) {
                    try {
                        profileCopy.expiresAt = new Date(profileCopy.expiresAt)
                            .toISOString()
                            .split('T')[0];
                    } catch (e) {
                        console.error('Error parsing expiresAt date:', e);
                        profileCopy.expiresAt = '';
                    }
                }
                if (!profileCopy.prefixSettings || typeof profileCopy.prefixSettings !== 'object') {
                    profileCopy.prefixSettings = {};
                }
                profileCopy.prefixSettings.enableManualNodes =
                    profileCopy.prefixSettings.enableManualNodes ?? null;
                profileCopy.prefixSettings.enableSubscriptions =
                    profileCopy.prefixSettings.enableSubscriptions ?? null;
                profileCopy.prefixSettings.manualNodePrefix =
                    profileCopy.prefixSettings.manualNodePrefix ?? '';
                profileCopy.prefixSettings.prependGroupName =
                    profileCopy.prefixSettings.prependGroupName ?? null;

                if (
                    Object.prototype.hasOwnProperty.call(
                        profileCopy.prefixSettings,
                        'enableNodeEmoji'
                    )
                ) {
                    delete profileCopy.prefixSettings.enableNodeEmoji;
                }

                // 确保 subconverter 对象存在
                if (!profileCopy.subconverter || typeof profileCopy.subconverter !== 'object') {
                    profileSub: profileCopy.subconverter = {
                        engineMode: '',
                        backend: '',
                        options: {
                            udp: null,
                            emoji: null,
                            scv: null,
                            sort: null,
                            tfo: null,
                            list: null,
                        },
                    };
                } else {
                    // 补充缺失的 options 字段，支持 null (即跟随全局)
                    profileCopy.subconverter.options = profileCopy.subconverter.options || {};
                    const fields = ['udp', 'emoji', 'scv', 'sort', 'tfo', 'list'];
                    fields.forEach((f) => {
                        if (profileCopy.subconverter.options[f] === undefined) {
                            profileCopy.subconverter.options[f] = null;
                        }
                    });
                }

                // 确保 operators 数组存在
                profileCopy.operators = Array.isArray(profileCopy.operators)
                    ? profileCopy.operators
                    : [];

                localProfile.value = profileCopy;
            } else {
                localProfile.value = {
                    name: '',
                    enabled: true,
                    subscriptions: [],
                    manualNodes: [],
                    customId: '',
                    expiresAt: '',
                    isPublic: true,
                    description: '',
                    prefixSettings: {
                        enableManualNodes: null,
                        enableSubscriptions: null,
                        manualNodePrefix: '',
                        prependGroupName: null,
                    },
                    operators: [],
                    flagEmojiMode: 'inherit',
                    flagEmojiPosition: 'inherit',
                    regionOverrideMode: 'inherit',
                    regionOverrides: [],
                };
            }
        },
        { deep: true, immediate: true }
    );

    const handleConfirm = () => {
        const profileToSave = JSON.parse(JSON.stringify(localProfile.value));
        if (profileToSave.expiresAt) {
            try {
                // Set time to the end of the selected day in local time, then convert to ISO string
                const date = new Date(profileToSave.expiresAt);
                date.setHours(23, 59, 59, 999);
                profileToSave.expiresAt = date.toISOString();
            } catch (e) {
                console.error('Error processing expiresAt date:', e);
                // Decide how to handle error: save as is, or clear it
                profileToSave.expiresAt = '';
            }
        }
        // 顺序已由用户通过拖拽确定，无需额外排序
        emit('save', profileToSave);
    };

    const toggleSelection = (listName, id) => {
        const list = localProfile.value[listName];
        const index = list.indexOf(id);
        if (index > -1) {
            list.splice(index, 1);
        } else {
            list.push(id);
        }
    };

    const handleSelectAll = (listName, sourceArray) => {
        const currentSelection = new Set(localProfile.value[listName]);
        sourceArray.forEach((item) => currentSelection.add(item.id));
        localProfile.value[listName] = Array.from(currentSelection);
    };

    const handleDeselectAll = (listName, sourceArray) => {
        const sourceIds = sourceArray.map((item) => item.id);
        localProfile.value[listName] = localProfile.value[listName].filter(
            (id) => !sourceIds.includes(id)
        );
    };

    // 处理拖拽排序后的 ID 顺序更新
    const updateSelectedIds = (listName, newIds) => {
        localProfile.value[listName] = newIds;
    };
</script>

<template>
    <Modal
        :show="show"
        @update:show="emit('update:show', $event)"
        @confirm="handleConfirm"
        size="6xl"
        body-height="60vh"
    >
        <template #title>
            <div class="flex items-center gap-3">
                <div class="shrink-0 p-2 misub-radius-lg bg-indigo-500/10">
                    <!-- Folder Icon for Profile -->
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-6 w-6 text-indigo-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                        />
                    </svg>
                </div>
                <div class="min-w-0">
                    <h3 class="text-lg font-bold text-gray-800 dark:text-white">
                        {{ isNew ? t('profiles.addTitle') : t('profiles.editTitle') }}
                    </h3>
                    <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                        {{ t('profiles.modalDescription') }}
                    </p>
                </div>
            </div>
        </template>
        <template #body>
            <div v-if="localProfile" class="space-y-6">
                <ProfileForm
                    :local-profile="localProfile"
                    :show-advanced="showAdvanced"
                    :ui-text="uiText"
                    :prefix-toggle-options="prefixToggleOptions"
                    :group-prefix-toggle-options="groupPrefixToggleOptions"
                    :global-settings="dataStore.settings"
                    @toggle-advanced="showAdvanced = !showAdvanced"
                />

                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <SubscriptionSelector
                        :subscriptions="selectableSubscriptions"
                        :filtered-subscriptions="filteredSubscriptions"
                        :search-term="subscriptionSearchTerm"
                        :selected-ids="localProfile.subscriptions || []"
                        @update:search-term="subscriptionSearchTerm = $event"
                        @update:selected-ids="updateSelectedIds('subscriptions', $event)"
                        @toggle-selection="toggleSelection('subscriptions', $event)"
                        @select-all="handleSelectAll('subscriptions', filteredSubscriptions)"
                        @deselect-all="handleDeselectAll('subscriptions', filteredSubscriptions)"
                    />

                    <NodeSelector
                        :nodes="allManualNodes"
                        :filtered-nodes="filteredManualNodes"
                        :search-term="nodeSearchTerm"
                        :active-group-filter="activeManualNodeGroupFilter"
                        :groups="manualNodeGroups"
                        :selected-ids="localProfile.manualNodes || []"
                        @update:search-term="nodeSearchTerm = $event"
                        @update:group-filter="activeManualNodeGroupFilter = $event"
                        @update:selected-ids="updateSelectedIds('manualNodes', $event)"
                        @toggle-selection="toggleSelection('manualNodes', $event)"
                        @select-all="handleSelectAll('manualNodes', filteredManualNodes)"
                        @deselect-all="handleDeselectAll('manualNodes', filteredManualNodes)"
                    />
                </div>
            </div>
        </template>
    </Modal>
</template>
