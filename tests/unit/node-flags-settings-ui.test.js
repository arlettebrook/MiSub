import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import { createI18n } from '../../src/i18n/index.js';
import NodeFlagSettings from '../../src/components/settings/NodeFlagSettings.vue';
import RegionOverridePreview from '../../src/components/settings/RegionOverridePreview.vue';
import RegionFlag from '../../src/components/ui/RegionFlag.vue';
import FlagNodeName from '../../src/components/ui/FlagNodeName.vue';
import RegionOverrideSettings from '../../src/components/settings/RegionOverrideSettings.vue';

const plugins = () => [createI18n({ initialLocale: 'zh-CN' })];
describe('node flag controls', () => {
    it.each([
        [
            { nodeTransform: { flagEmojiMode: 'preserve', flagEmojiPosition: 'suffix' } },
            {},
            'preserve',
        ],
        [{ nodeTransform: { addFlagEmoji: false, flagEmojiPosition: 'suffix' } }, {}, 'remove'],
        [
            { nodeTransformPresetId: 'preset' },
            {
                nodeTransformPresets: [
                    { id: 'preset', config: { addFlagEmoji: false, flagEmojiPosition: 'suffix' } },
                ],
            },
            'remove',
        ],
    ])(
        'displays existing profile or preset flag settings without changing the draft',
        (model, globalSettings, expectedMode) => {
            const before = JSON.stringify(model);
            const wrapper = mount(NodeFlagSettings, {
                props: { model, inherit: true, globalSettings },
                global: { plugins: plugins() },
            });
            expect(wrapper.get('[data-testid=flag-mode]').element.value).toBe(expectedMode);
            expect(wrapper.get('[data-testid=flag-position]').element.value).toBe('suffix');
            expect(JSON.stringify(model)).toBe(before);
            wrapper.unmount();
        }
    );
    it('reads old global boolean settings and saves mode/position choices', async () => {
        const model = reactive({ enableFlagEmoji: false });
        const wrapper = mount(NodeFlagSettings, {
            props: { model },
            global: { plugins: plugins() },
        });
        expect(wrapper.get('[data-testid=flag-mode]').element.value).toBe('remove');
        await wrapper.get('[data-testid=flag-mode]').setValue('preserve');
        await wrapper.get('[data-testid=flag-position]').setValue('suffix');
        expect(model.flagEmojiMode).toBe('preserve');
        expect(model.flagEmojiPosition).toBe('suffix');
    });
    it('allows a profile to inherit a changing global setting', async () => {
        const model = reactive({ flagEmojiMode: 'inherit', flagEmojiPosition: 'inherit' });
        const globalSettings = reactive({ flagEmojiMode: 'auto', flagEmojiPosition: 'suffix' });
        const wrapper = mount(NodeFlagSettings, {
            props: { model, inherit: true, globalSettings },
            global: { plugins: plugins() },
        });
        expect(wrapper.text()).toContain('当前全局：自动补齐 · 名称后缀');
        globalSettings.flagEmojiMode = 'remove';
        await nextTick();
        expect(wrapper.text()).toContain('当前全局：移除旗帜');
    });
});

describe('live region-rule preview', () => {
    it('clears obsolete rows after a processing error and ignores late worker errors after unmount', async () => {
        const workers = [];
        class WorkerStub {
            constructor() {
                workers.push(this);
            }
            sent = [];
            postMessage(value) {
                this.sent.push(value);
            }
            terminate = vi.fn();
        }
        vi.stubGlobal('Worker', WorkerStub);
        let wrapper;
        try {
            const { previewNodeProcessing } =
                await import('../../functions/utils/node-processing.js');
            wrapper = mount(RegionOverridePreview, {
                props: { settings: {} },
                global: { plugins: plugins() },
            });
            const worker = workers[0];
            worker.onmessage({
                data: {
                    id: worker.sent[0].id,
                    result: await previewNodeProcessing('US/JP', null, {}),
                },
            });
            await flushPromises();
            expect(wrapper.findAll('tbody tr')).toHaveLength(1);
            await wrapper.get('[data-testid=region-samples]').setValue('New sample');
            worker.onmessage({ data: { id: worker.sent.at(-1).id, error: 'Processing failed' } });
            await flushPromises();
            expect(wrapper.get('[role=alert]').text()).toBe('Processing failed');
            expect(wrapper.findAll('tbody tr')).toHaveLength(0);
            wrapper.unmount();
            wrapper = null;
            expect(() => worker.onerror()).not.toThrow();
            expect(worker.terminate).toHaveBeenCalledOnce();
        } finally {
            wrapper?.unmount();
            vi.unstubAllGlobals();
        }
    });
    it('keeps only one active worker job and the latest pending sample', async () => {
        const workers = [];
        class WorkerStub {
            constructor() {
                workers.push(this);
            }
            sent = [];
            postMessage(value) {
                this.sent.push(value);
            }
            terminate = vi.fn();
        }
        vi.stubGlobal('Worker', WorkerStub);
        let wrapper;
        try {
            wrapper = mount(RegionOverridePreview, {
                props: { settings: {} },
                global: { plugins: plugins() },
            });
            const worker = workers[0],
                first = worker.sent[0];
            await wrapper.get('[data-testid=region-samples]').setValue('US-01');
            await wrapper.get('[data-testid=region-samples]').setValue('JP-01');
            expect(worker.sent).toHaveLength(1);
            worker.onmessage({
                data: { id: first.id, result: { rows: [], errors: [], outputCount: 0 } },
            });
            expect(worker.sent).toHaveLength(2);
            expect(worker.sent[1].samples).toBe('JP-01');
        } finally {
            wrapper?.unmount();
            vi.unstubAllGlobals();
        }
    });
    it('disables stale country choices while a new worker result is pending', async () => {
        const workers = [];
        class WorkerStub {
            constructor() {
                workers.push(this);
            }
            sent = [];
            postMessage(value) {
                this.sent.push(value);
            }
            terminate() {}
        }
        vi.stubGlobal('Worker', WorkerStub);
        let wrapper;
        try {
            const { previewNodeProcessing } =
                await import('../../functions/utils/node-processing.js');
            wrapper = mount(RegionOverridePreview, {
                props: { settings: {} },
                global: { plugins: plugins() },
            });
            const worker = workers[0];
            worker.onmessage({
                data: {
                    id: worker.sent[0].id,
                    result: await previewNodeProcessing('US/JP', null, {}),
                },
            });
            await flushPromises();
            expect(wrapper.get('[data-testid=region-choice]').element.disabled).toBe(false);
            await wrapper.get('[data-testid=region-samples]').setValue('DE/FR');
            expect(wrapper.get('[data-testid=region-choice]').element.disabled).toBe(true);
        } finally {
            wrapper?.unmount();
            vi.unstubAllGlobals();
        }
    });
    it('shows conflicts and saves an exact all-scope destination rule', async () => {
        const settings = reactive({ regionOverrides: [] });
        const wrapper = mount(RegionOverridePreview, {
            props: { settings },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('⚡ US/JP [VIP]');
        await flushPromises();
        expect(wrapper.get('[data-testid=region-conflict]').text()).toContain('美国 (US)');
        expect(wrapper.get('[data-testid=region-conflict]').text()).toContain('日本 (JP)');
        expect(
            wrapper.findAll('tbody td')[1].findComponent(FlagNodeName).attributes('aria-label')
        ).toBe('🌍 ⚡ US/JP [VIP]');
        await wrapper.get('[data-testid=region-choice]').setValue('JP');
        await flushPromises();
        expect(settings.regionOverrides[0]).toMatchObject({ region: 'JP', scope: 'all' });
        expect(new RegExp(settings.regionOverrides[0].pattern).test('⚡ US/JP [VIP]')).toBe(true);
        expect(new RegExp(settings.regionOverrides[0].pattern).test('⚡ US/JP VIP')).toBe(false);
        expect(
            wrapper.findAll('tbody td')[1].findComponent(FlagNodeName).attributes('aria-label')
        ).toBe('🇯🇵 ⚡ US/JP [VIP]');
    });
    it('executes filters, multiple templates and scripts and displays output order', async () => {
        const settings = {
            defaultOperators: [
                { type: 'filter', params: { exclude: { enabled: true, rules: ['Drop'] } } },
                { type: 'rename', params: { template: { enabled: true, template: '{region}' } } },
                { type: 'script', params: { dsl: [{ action: 'rename', template: '⚡ {name}' }] } },
                { type: 'sort', params: { keys: [{ key: 'name', order: 'desc' }] } },
                {
                    type: 'rename',
                    params: {
                        template: { enabled: true, template: '{emoji}{name}-{globalIndex}' },
                    },
                },
            ],
        };
        const wrapper = mount(RegionOverridePreview, {
            props: { settings },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('US-01\nDrop\nJP-01');
        await flushPromises();
        expect(wrapper.get('[data-testid=sample-filtered]').text()).toContain('已被筛选');
        expect(wrapper.findAll('tbody tr')[0].findAll('td')[1].text()).toContain('输出序号');
        expect(
            wrapper
                .findAllComponents(FlagNodeName)
                .some((component) => component.attributes('aria-label')?.includes('⚡ 美国'))
        ).toBe(true);
    });
    it('edits profile rule inheritance without changing global rules', async () => {
        const globalSettings = reactive({
            regionOverrides: [{ pattern: 'US', region: 'JP', scope: 'all' }],
        });
        const model = reactive({
            regionOverrideMode: 'inherit',
            regionOverrides: [{ pattern: 'US', region: 'DE', scope: 'all' }],
        });
        const wrapper = mount(RegionOverrideSettings, {
            props: { model, globalSettings, inherit: true },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('US-01');
        await flushPromises();
        expect(
            wrapper.findAll('tbody td')[1].findComponent(FlagNodeName).attributes('aria-label')
        ).toBe('🇯🇵 US-01');
        await wrapper.get('[data-testid=region-rule-mode]').setValue('extend');
        await flushPromises();
        expect(
            wrapper.findAll('tbody td')[1].findComponent(FlagNodeName).attributes('aria-label')
        ).toBe('🇩🇪 US-01');
        expect(globalSettings.regionOverrides[0].region).toBe('JP');
    });
    it('does not apply a legacy template hidden by an active workflow', async () => {
        const wrapper = mount(RegionOverridePreview, {
            props: {
                settings: {
                    defaultNodeTransform: {
                        enabled: true,
                        rename: { template: { enabled: true, template: '{region}-{index}' } },
                    },
                    defaultOperators: [{ type: 'filter', enabled: true, params: {} }],
                },
            },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('⚡ US-01');
        await flushPromises();
        expect(
            wrapper.findAll('tbody td')[1].findComponent(FlagNodeName).attributes('aria-label')
        ).toBe('🇺🇸 ⚡ US-01');
    });
    it('uses transform workflows and region template counters in the sample preview', async () => {
        const wrapper = mount(RegionOverridePreview, {
            props: {
                settings: {
                    defaultNodeTransform: {
                        enabled: true,
                        operators: [
                            {
                                type: 'rename',
                                params: {
                                    template: {
                                        enabled: true,
                                        template: '{emoji}{region}-{index}',
                                        offset: 3,
                                        indexScope: 'region',
                                    },
                                },
                            },
                        ],
                    },
                },
            },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('US-01\nJP-01\nUS-02');
        await flushPromises();
        expect(
            wrapper
                .findAll('tbody tr')
                .map((row) =>
                    row.findAll('td')[1].findComponent(FlagNodeName).attributes('aria-label')
                )
        ).toEqual(['🇺🇸美国-3', '🇯🇵日本-3', '🇺🇸美国-4']);
    });
    it('shows match counts and updates group-only and all-scope results immediately', async () => {
        const settings = reactive({
            flagEmojiMode: 'auto',
            flagEmojiPosition: 'prefix',
            regionOverrides: [{ pattern: '新加坡', region: 'US', flags: 'i', scope: 'group' }],
        });
        const wrapper = mount(RegionOverridePreview, {
            props: { settings },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('🇸🇬 新加坡 原生');
        await flushPromises();
        expect(wrapper.get('[data-testid=region-match-count]').text()).toBe('命中 1 / 1 个样本');
        let cells = wrapper.findAll('tbody td');
        expect(cells[1].find('img').attributes('src')).toBe('/flags/sg.svg');
        expect(cells[2].find('img').attributes('src')).toBe('/flags/us.svg');
        expect(cells[3].text()).toContain('地区覆盖规则');
        settings.regionOverrides[0].scope = 'all';
        await nextTick();
        await flushPromises();
        cells = wrapper.findAll('tbody td');
        expect(cells[1].find('img').attributes('src')).toBe('/flags/us.svg');
        settings.flagEmojiMode = 'remove';
        await nextTick();
        await flushPromises();
        expect(cells[1].findComponent(FlagNodeName).attributes('aria-label')).toBe('新加坡 原生');
    });
    it('reports invalid regex while keeping valid rules active', async () => {
        const settings = reactive({
            regionOverrides: [
                { pattern: '[', region: 'JP' },
                { pattern: 'US', region: 'US', scope: 'all' },
            ],
        });
        const wrapper = mount(RegionOverridePreview, {
            props: { settings },
            global: { plugins: plugins() },
        });
        await wrapper.get('[data-testid=region-samples]').setValue('US-01');
        await flushPromises();
        expect(wrapper.get('[role=alert]').text()).toContain('规则 1 的正则无效');
        expect(wrapper.get('[data-testid=region-match-count]').text()).toBe('命中 1 / 1 个样本');
    });
    it('counts all samples while rendering a bounded table', async () => {
        const wrapper = mount(RegionOverridePreview, {
            props: { settings: { regionOverrides: [] } },
            global: { plugins: plugins() },
        });
        await wrapper
            .get('[data-testid=region-samples]')
            .setValue(Array.from({ length: 75 }, (_, index) => `US-${index}`).join('\n'));
        await flushPromises();
        expect(wrapper.findAll('tbody tr')).toHaveLength(50);
        expect(wrapper.get('[data-testid=region-match-count]').text()).toContain('/ 75');
    });
});

describe('local vector flags', () => {
    it('renders national flags as SVG images while keeping other emoji as text', () => {
        const wrapper = mount(FlagNodeName, { props: { name: '🏁 🚀 🇺🇸 US-01' } });
        expect(wrapper.get('img').attributes('src')).toBe('/flags/us.svg');
        expect(wrapper.text()).toContain('🏁 🚀');
        expect(wrapper.attributes('aria-label')).toBe('🏁 🚀 🇺🇸 US-01');
    });
    it('uses a local globe for unknown regions and image errors', async () => {
        const wrapper = mount(RegionFlag, { props: { region: '其他' } });
        expect(wrapper.get('img').attributes('src')).toBe('/flags/globe.svg');
        await wrapper.setProps({ region: '美国' });
        expect(wrapper.get('img').attributes('src')).toBe('/flags/us.svg');
        await wrapper.get('img').trigger('error');
        expect(wrapper.get('img').attributes('src')).toBe('/flags/globe.svg');
    });
});
