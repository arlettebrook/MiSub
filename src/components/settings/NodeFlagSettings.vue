<script setup>
    import { computed } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import { resolveNodeFlagPolicy } from '../../../shared/node-flag-policy.js';
    const props = defineProps({
        model: { type: Object, required: true },
        inherit: Boolean,
        globalSettings: { type: Object, default: () => ({}) },
    });
    const { t } = useI18n();
    const inherited = computed(() => resolveNodeFlagPolicy({}, props.globalSettings));
    const ownTransform = computed(() => {
        const own = props.model.nodeTransform;
        if (own && Object.keys(own).length) return own;
        const presets = Array.isArray(props.globalSettings.nodeTransformPresets)
            ? props.globalSettings.nodeTransformPresets
            : [];
        return (
            presets.find((preset) => preset?.id === props.model.nodeTransformPresetId)?.config || {}
        );
    });
    const mode = computed({
        get: () =>
            props.model.flagEmojiMode ||
            (props.inherit
                ? ['auto', 'preserve', 'remove', 'inherit'].includes(
                      ownTransform.value.flagEmojiMode
                  )
                    ? ownTransform.value.flagEmojiMode
                    : typeof ownTransform.value.addFlagEmoji === 'boolean'
                      ? ownTransform.value.addFlagEmoji
                          ? 'auto'
                          : 'remove'
                      : 'inherit'
                : resolveNodeFlagPolicy({}, props.model).requestedMode),
        set: (value) => {
            props.model.flagEmojiMode = value;
            if (!props.inherit) props.model.enableFlagEmoji = value !== 'remove';
        },
    });
    const position = computed({
        get: () =>
            props.model.flagEmojiPosition ||
            (props.inherit ? ownTransform.value.flagEmojiPosition || 'inherit' : 'prefix'),
        set: (value) => {
            props.model.flagEmojiPosition = value;
        },
    });
</script>
<template>
    <div class="space-y-3" data-testid="node-flag-settings">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label class="text-sm text-gray-700 dark:text-gray-300"
                >{{ t('nodeFlags.mode') }}
                <select
                    v-model="mode"
                    data-testid="flag-mode"
                    class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                >
                    <option v-if="inherit" value="inherit">{{ t('nodeFlags.inherit') }}</option>
                    <option value="auto">{{ t('nodeFlags.auto') }}</option>
                    <option value="preserve">{{ t('nodeFlags.preserve') }}</option>
                    <option value="remove">{{ t('nodeFlags.remove') }}</option>
                </select>
            </label>
            <label class="text-sm text-gray-700 dark:text-gray-300"
                >{{ t('nodeFlags.position') }}
                <select
                    v-model="position"
                    data-testid="flag-position"
                    class="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
                >
                    <option v-if="inherit" value="inherit">{{ t('nodeFlags.inherit') }}</option>
                    <option value="prefix">{{ t('nodeFlags.prefix') }}</option>
                    <option value="suffix">{{ t('nodeFlags.suffix') }}</option>
                </select>
            </label>
        </div>
        <p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {{ t('nodeFlags.help') }}
        </p>
        <p
            v-if="inherit && (mode === 'inherit' || position === 'inherit')"
            class="text-xs text-indigo-600 dark:text-indigo-400"
        >
            {{
                t('nodeFlags.inherited', {
                    mode: t(`nodeFlags.${inherited.requestedMode}`),
                    position: t(`nodeFlags.${inherited.position}`),
                })
            }}
        </p>
    </div>
</template>
