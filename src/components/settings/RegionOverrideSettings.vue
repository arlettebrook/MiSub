<script setup>
    import { computed } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import Input from '../ui/Input.vue';
    import RegionOverridePreview from './RegionOverridePreview.vue';
    const props = defineProps({
        model: { type: Object, required: true },
        globalSettings: { type: Object, default: () => ({}) },
        inherit: Boolean,
    });
    const { t } = useI18n();
    const rules = computed(() =>
        Array.isArray(props.model.regionOverrides) ? props.model.regionOverrides : []
    );
    const mode = computed({
        get: () => props.model.regionOverrideMode || (rules.value.length ? 'extend' : 'inherit'),
        set: (value) => {
            props.model.regionOverrideMode = value;
        },
    });
    function add() {
        if (!Array.isArray(props.model.regionOverrides)) props.model.regionOverrides = [];
        if (props.inherit && mode.value === 'inherit') mode.value = 'extend';
        props.model.regionOverrides.push({ pattern: '', region: 'US', flags: 'i', scope: 'group' });
    }
</script>
<template>
    <div class="space-y-3" data-testid="region-override-settings">
        <div class="flex flex-wrap items-center justify-between gap-3">
            <h4 class="text-sm font-semibold">{{ t('settings.regionOverridesTitle') }}</h4>
            <button
                type="button"
                @click="add"
                class="rounded-lg bg-purple-600 px-3 py-2 text-xs text-white"
            >
                {{ t('settings.regionOverrideAdd') }}
            </button>
        </div>
        <label v-if="inherit" class="block text-sm"
            >{{ t('nodeFlags.ruleMode') }}
            <select
                v-model="mode"
                data-testid="region-rule-mode"
                class="mt-1 block w-full rounded border p-2 dark:bg-gray-800"
            >
                <option value="inherit">{{ t('nodeFlags.rulesInherit') }}</option>
                <option value="extend">{{ t('nodeFlags.rulesExtend') }}</option>
                <option value="replace">{{ t('nodeFlags.rulesReplace') }}</option>
            </select>
        </label>
        <p v-if="inherit" class="text-xs text-gray-500">{{ t('nodeFlags.rulePriority') }}</p>
        <div
            v-for="(rule, index) in rules"
            :key="index"
            class="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2"
            :class="inherit && mode === 'inherit' ? 'opacity-50' : ''"
        >
            <Input v-model="rule.pattern" :label="t('settings.regionOverridePattern')" />
            <Input v-model="rule.region" :label="t('settings.regionOverrideRegion')" />
            <Input v-model="rule.flags" :label="t('settings.regionOverrideFlags')" />
            <label class="text-xs"
                >{{ t('nodeFlags.scope')
                }}<select
                    :value="rule.scope || 'group'"
                    @change="rule.scope = $event.target.value"
                    data-testid="region-scope"
                    class="mt-1 block w-full rounded border p-2 dark:bg-gray-800"
                >
                    <option value="group">{{ t('nodeFlags.scopeGroup') }}</option>
                    <option value="all">{{ t('nodeFlags.scopeAll') }}</option>
                </select></label
            >
            <button
                type="button"
                @click="model.regionOverrides.splice(index, 1)"
                class="text-left text-xs text-red-600"
            >
                {{ t('actions.delete') }}
            </button>
        </div>
        <RegionOverridePreview
            :settings="inherit ? globalSettings : model"
            :profile="inherit ? model : null"
        />
    </div>
</template>
