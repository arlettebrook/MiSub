import { describe, it, expect } from 'vitest';
import { getProcessedUserAgent } from '../../functions/utils/format-utils.js';

describe('format-utils getProcessedUserAgent', () => {
    it('带 clash 参数的订阅源应使用 Clash UA 拉取', () => {
        expect(getProcessedUserAgent('ClashMeta', 'http://example.com/link/token?clash=2')).toBe(
            'clash-verge/v2.5.10'
        );
    });

    it('普通订阅源默认使用最新 Clash Verge UA', () => {
        expect(getProcessedUserAgent('ClashMeta', 'http://example.com/link/token')).toBe(
            'clash-verge/v2.5.10'
        );
    });
});
