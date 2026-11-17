<script setup>
    import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
    import { useI18n } from '../../i18n/index.js';
    import { previewNodeProcessing } from '../../../functions/utils/node-processing.js';
    import { resolveRegionOverrides } from '../../../shared/node-region-context.js';
    import FlagNodeName from '../ui/FlagNodeName.vue';
    import RegionFlag from '../ui/RegionFlag.vue';
    const props = defineProps({
        settings: { type: Object, required: true },
        profile: { type: Object, default: null },
    });
    const { t } = useI18n();
    const samples = ref('🇸🇬 新加坡 原生\n⚡ US-01\n🏁 JP-02\nCustomNode');
    const result = ref({ rows: [], errors: [], outputCount: 0 });
    const pending = ref(false),
        error = ref('');
    let worker,
        revision = 0,
        busy = false,
        queued = null,
        disposed = false;
    const accept = (data) => {
        if (data.id !== revision) return;
        pending.value = false;
        error.value = data.error || '';
        if (data.result) result.value = data.result;
        else if (data.error) result.value = { rows: [], errors: [], outputCount: 0 };
    };
    function send(payload) {
        busy = true;
        worker.postMessage(payload);
    }
    async function update() {
        if (disposed) return;
        const id = ++revision;
        pending.value = true;
        error.value = '';
        // 样本仅在本地处理，不发送节点链接或配置给服务器。
        const settings = JSON.parse(JSON.stringify(props.settings));
        const profile = props.profile ? JSON.parse(JSON.stringify(props.profile)) : null;
        if (worker) {
            const payload = { id, samples: samples.value, settings, profile };
            if (busy) queued = payload;
            else send(payload);
            return;
        }
        try {
            accept({ id, result: await previewNodeProcessing(samples.value, profile, settings) });
        } catch (failure) {
            accept({ id, error: failure.message });
        }
    }
    watch([samples, () => props.settings, () => props.profile], update, {
        deep: true,
        immediate: true,
    });
    onMounted(() => {
        if (typeof Worker === 'undefined') return;
        try {
            worker = new Worker(
                new URL('../../workers/node-processing-preview.worker.js', import.meta.url),
                { type: 'module' }
            );
        } catch {
            worker = null;
            return;
        }
        worker.onmessage = ({ data }) => {
            if (disposed) return;
            busy = false;
            accept(data);
            if (queued) {
                const payload = queued;
                queued = null;
                send(payload);
            }
        };
        worker.onerror = () => {
            if (disposed) return;
            worker?.terminate();
            worker = null;
            busy = false;
            queued = null;
            update();
        };
        update();
    });
    onBeforeUnmount(() => {
        disposed = true;
        revision++;
        queued = null;
        worker?.terminate();
    });
    const rows = computed(() => result.value.rows);
    const rules = computed(() => resolveRegionOverrides(props.profile, props.settings));
    const counts = computed(() =>
        rules.value.map(
            (_rule, index) => rows.value.filter((row) => row.ruleHits.includes(index)).length
        )
    );
    const matched = computed(() => rows.value.filter((row) => row.ruleHits.length).length);
    function selectRegion(row, region) {
        if (!region || pending.value || error.value) return;
        const model = props.profile || props.settings;
        if (!Array.isArray(model.regionOverrides)) model.regionOverrides = [];
        if (props.profile && (!model.regionOverrideMode || model.regionOverrideMode === 'inherit'))
            model.regionOverrideMode = 'extend';
        const escaped = row.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        model.regionOverrides.unshift({
            pattern: `^${escaped}$`,
            region,
            flags: 'i',
            scope: 'all',
        });
    }
</script>
<template>
    <div
        class="mt-5 space-y-3 rounded-xl border border-purple-100 bg-purple-50/40 p-4 dark:border-purple-500/20 dark:bg-purple-500/5"
        data-testid="region-rule-preview"
    >
        <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {{ t('nodeFlags.preview') }}
        </h4>
        <label class="block text-xs text-gray-600 dark:text-gray-400"
            >{{ t('nodeFlags.samples') }}
            <textarea
                v-model="samples"
                data-testid="region-samples"
                rows="4"
                class="mt-1 block w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs dark:border-gray-600 dark:bg-gray-800"
            />
        </label>
        <p class="text-xs text-gray-500">{{ t('nodeFlags.sampleHelp') }}</p>
        <p v-if="pending" role="status" class="text-xs text-gray-500">
            {{ t('nodeFlags.processing') }}
        </p>
        <p v-if="error" role="alert" class="text-xs text-red-600">{{ error }}</p>
        <p class="text-xs text-gray-500">
            {{ t('nodeFlags.outputCount', { count: result.outputCount }) }}
        </p>
        <p class="text-xs font-medium" data-testid="region-match-count">
            {{ t('nodeFlags.matchCount', { matched, total: rows.length }) }}
        </p>
        <div class="flex flex-wrap gap-2">
            <span
                v-for="(count, index) in counts"
                :key="index"
                class="rounded-full bg-white px-2 py-1 text-xs dark:bg-gray-800"
                >{{ t('nodeFlags.ruleCount', { index: index + 1, count }) }}</span
            >
        </div>
        <p
            v-for="error in result.errors"
            :key="error.index"
            role="alert"
            class="text-xs text-red-600"
        >
            {{ t('nodeFlags.invalidRule', { index: error.index + 1 }) }}: {{ error.message }}
        </p>
        <p class="text-xs text-gray-500 sm:hidden">{{ t('nodeFlags.horizontal') }}</p>
        <div class="overflow-x-auto">
            <table class="min-w-[640px] w-full text-left text-xs" :aria-busy="pending">
                <thead>
                    <tr class="border-b border-gray-200 dark:border-gray-700">
                        <th class="p-2">{{ t('nodeFlags.before') }}</th>
                        <th class="p-2">{{ t('nodeFlags.after') }}</th>
                        <th class="p-2">{{ t('nodeFlags.group') }}</th>
                        <th class="p-2">{{ t('nodeFlags.source') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="(row, index) in rows.slice(0, 50)"
                        :key="index"
                        class="border-b border-gray-100 dark:border-gray-800"
                    >
                        <td class="p-2">
                            <FlagNodeName :name="row.name" />
                            <div class="mt-1 text-gray-500">
                                <RegionFlag :region="row.before.region" label />
                            </div>
                        </td>
                        <td class="p-2">
                            <span
                                v-if="row.filtered"
                                class="text-gray-500"
                                data-testid="sample-filtered"
                                >{{ t('nodeFlags.filtered') }}</span
                            >
                            <template v-else
                                ><FlagNodeName :name="row.newName" />
                                <div class="text-gray-500">
                                    {{ t('nodeFlags.outputOrder', { index: row.outputIndex + 1 }) }}
                                </div></template
                            >
                            <div class="mt-1 text-gray-500">
                                <RegionFlag :region="row.after.region" label />
                            </div>
                        </td>
                        <td class="p-2"><RegionFlag :region="row.group.region" label /></td>
                        <td class="p-2">
                            {{ t(`nodeFlags.source_${row.reason.source}`)
                            }}<span
                                v-if="row.reason.matched"
                                class="block break-all text-gray-500"
                                >{{ row.reason.matched }}</span
                            >
                            <div
                                v-if="row.reason.candidates?.length > 1"
                                class="mt-2 space-y-1"
                                data-testid="region-conflict"
                            >
                                <span class="block text-amber-700 dark:text-amber-300"
                                    >{{ t('nodeFlags.candidates') }}:
                                    {{
                                        row.reason.candidates
                                            .map((item) => `${item.region} (${item.matched})`)
                                            .join(' / ')
                                    }}</span
                                >
                                <label class="block"
                                    >{{ t('nodeFlags.chooseDestination') }}
                                    <select
                                        :disabled="pending || Boolean(error)"
                                        :value="''"
                                        @change="selectRegion(row, $event.target.value)"
                                        class="mt-1 block w-full rounded border bg-white p-1 dark:bg-gray-800"
                                        data-testid="region-choice"
                                    >
                                        <option value="">{{ t('nodeFlags.chooseRegion') }}</option>
                                        <option
                                            v-for="candidate in row.reason.candidates"
                                            :key="candidate.code"
                                            :value="candidate.code"
                                        >
                                            {{ candidate.region }}
                                        </option>
                                    </select>
                                </label>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <p v-if="rows.length > 50" class="text-xs text-gray-500">
            {{ t('nodeFlags.previewLimit') }}
        </p>
    </div>
</template>
