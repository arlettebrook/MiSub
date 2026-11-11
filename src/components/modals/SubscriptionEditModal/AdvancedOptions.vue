<script setup>
    import { computed } from 'vue';
    import Switch from '../../ui/Switch.vue';
    import UserAgentInput from './UserAgentInput.vue';
    import { useI18n } from '../../../i18n/index.js';
    import { getUserAgentState, validateUserAgent } from '../../../../shared/user-agents.js';

    const { t } = useI18n();

    const props = defineProps({
        editingSubscription: {
            type: Object,
            required: true,
        },
    });

    const selectedUserAgent = computed({
        get: () => {
            const userAgent = props.editingSubscription.customUserAgent;
            return typeof userAgent === 'string' && userAgent.trim() ? userAgent : '';
        },
        set: (userAgent) => {
            props.editingSubscription.customUserAgent = userAgent;
        },
    });
    const userAgentState = computed(() =>
        getUserAgentState(props.editingSubscription.customUserAgent)
    );
    const userAgentError = computed(() => {
        const result = validateUserAgent(props.editingSubscription.customUserAgent);
        return result.valid ? '' : t(`subscriptions.uaValidation.${result.code}`);
    });
</script>

<template>
    <!-- User-Agent -->
    <div>
        <label for="sub-edit-ua" class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('subscriptions.uaLabel') }}
        </label>
        <UserAgentInput
            id="sub-edit-ua"
            v-model="selectedUserAgent"
            class="mt-1"
            described-by="sub-edit-ua-hint sub-edit-ua-current"
            :error="userAgentError"
        />
        <p id="sub-edit-ua-hint" class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {{ t('subscriptions.uaInputHint') }}
        </p>
        <p id="sub-edit-ua-current" class="break-all text-xs text-gray-500 dark:text-gray-400 mt-1">
            {{
                t(`subscriptions.uaState.${userAgentState.type}`, {
                    ua: userAgentState.value,
                })
            }}
        </p>
    </div>

    <!-- 官网 -->
    <div>
        <label
            for="sub-edit-website"
            class="block text-sm font-medium text-gray-700 dark:text-gray-300"
        >
            {{ t('subscriptions.websiteLabel') }}
            <span class="text-xs text-gray-500 ml-2">{{ t('subscriptions.websiteOptional') }}</span>
        </label>
        <input
            id="sub-edit-website"
            v-model="editingSubscription.website"
            type="url"
            inputmode="url"
            placeholder="https://example.com"
            class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 misub-radius-md dark:text-white font-mono text-sm"
        />
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ t('subscriptions.websiteHint') }}
        </p>
    </div>

    <!-- 备注 -->
    <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">{{
            t('subscriptions.notesLabel')
        }}</label>
        <textarea
            v-model="editingSubscription.notes"
            :placeholder="t('subscriptions.notesPlaceholder')"
            rows="2"
            class="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 misub-radius-md dark:text-white"
        ></textarea>
    </div>

    <!-- 开关选项 -->
    <div class="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
        <div class="flex items-center justify-between gap-4">
            <div>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{
                    t('subscriptions.nodeCacheTitle')
                }}</span>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('subscriptions.nodeCacheDesc') }}
                </p>
            </div>
            <Switch
                v-model="editingSubscription.enableNodeCache"
                :aria-label="t('subscriptions.nodeCacheTitle')"
            />
        </div>

        <div class="flex items-center justify-between gap-4">
            <div>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{
                    t('subscriptions.plusAsSpaceTitle')
                }}</span>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('subscriptions.plusAsSpaceDesc') }}
                </p>
            </div>
            <Switch
                v-model="editingSubscription.plusAsSpace"
                :aria-label="t('subscriptions.plusAsSpaceTitle')"
            />
        </div>

        <div class="flex items-center justify-between gap-4">
            <div>
                <span class="text-sm font-medium text-gray-700 dark:text-gray-200">{{
                    t('subscriptions.excludeTrafficTitle')
                }}</span>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {{ t('subscriptions.excludeTrafficDesc') }}
                </p>
            </div>
            <Switch
                v-model="editingSubscription.excludeTraffic"
                :aria-label="t('subscriptions.excludeTrafficTitle')"
            />
        </div>
    </div>
</template>
