import { describe, expect, it } from 'vitest';
import {
    DEFAULT_USER_AGENT,
    USER_AGENT_PRESETS,
    getUserAgentState,
    validateUserAgent,
} from '../../shared/user-agents.js';
import { DEFAULT_SETTINGS, SYSTEM_CONSTANTS } from '../../functions/modules/config.js';
import { getProcessedUserAgent } from '../../functions/utils/format-utils.js';
import { getProcessedUserAgent as legacyGetProcessedUserAgent } from '../../functions/modules/utils.js';

describe('shared subscription UA configuration', () => {
    it('keeps default fetch values aligned while preserving the original empty-input behavior', () => {
        expect(DEFAULT_USER_AGENT).toBe(
            USER_AGENT_PRESETS.find((item) => item.label === 'Clash Verge').value
        );
        expect(DEFAULT_SETTINGS.defaultUserAgent).toBe(DEFAULT_USER_AGENT);
        expect(SYSTEM_CONSTANTS.FETCHER_USER_AGENT).toBe(DEFAULT_USER_AGENT);
        for (const resolve of [getProcessedUserAgent, legacyGetProcessedUserAgent]) {
            expect(resolve('ClashMeta', 'https://example.com/sub')).toBe(DEFAULT_USER_AGENT);
            expect(resolve('ClashMeta', 'https://example.com/sub?clash=2')).toBe(
                DEFAULT_USER_AGENT
            );
            expect(resolve('ClashMeta', 'https://example.com/sub?target=clash')).toBe(
                DEFAULT_USER_AGENT
            );
            for (const empty of ['', undefined, null]) expect(resolve(empty)).toBe(empty);
        }
    });

    it('distinguishes default, preset and existing custom values without upgrading old versions', () => {
        expect(getUserAgentState(null)).toEqual({ type: 'default', value: DEFAULT_USER_AGENT });
        expect(getUserAgentState('   ')).toEqual({ type: 'default', value: DEFAULT_USER_AGENT });
        for (const preset of USER_AGENT_PRESETS) {
            expect(getUserAgentState(preset.value)).toEqual({
                type: 'preset',
                value: preset.value,
            });
            expect(validateUserAgent(preset.value).valid).toBe(true);
        }
        expect(getUserAgentState('clash-verge/v2.4.3')).toEqual({
            type: 'custom',
            value: 'clash-verge/v2.4.3',
        });
    });

    it.each([
        undefined,
        null,
        '',
        '   ',
        '\t',
        'CustomClient/1.0 (Android; test)',
        'Custom/1.0\tTest',
        'Custom/1.0 (é)',
    ])('accepts an empty or valid header value (%j)', (value) =>
        expect(validateUserAgent(value).valid).toBe(true)
    );

    it.each([
        ['\n', 'lineBreaks'],
        ['\r\n', 'lineBreaks'],
        ['UA/1.0\nInjected: yes', 'lineBreaks'],
        ['UA\u0000', 'controls'],
        ['UA\u0007', 'controls'],
        ['UA\u000B', 'controls'],
        ['UA\u007F', 'controls'],
        ['中文 UA', 'encoding'],
        ['UA😀', 'encoding'],
        ['\u200B', 'encoding'],
        [42, 'type'],
        [{}, 'type'],
    ])('rejects invalid input before it can be trimmed or saved (%j)', (value, code) => {
        expect(validateUserAgent(value)).toMatchObject({ valid: false, code });
    });
});
