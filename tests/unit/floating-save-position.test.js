import { describe, expect, it } from 'vitest';
import { createFloatingSavePosition } from '../../src/utils/floating-save-position.js';

describe('floating save positioning during mobile scrolling', () => {
    it('filters small header boundary fluctuations without starting an animation', () => {
        const position = createFloatingSavePosition();
        position.update({ headerHeight: 52, viewportTop: 0 });
        for (const headerHeight of [52.3, 51.7, 52.5, 51.4, 52.1]) {
            const result = position.update({
                headerHeight,
                viewportTop: 0,
                timestamp: 16,
                animate: true,
            });
            expect(result.headerOffset).toBe(52);
            expect(result.needsAnimation).toBe(false);
        }
    });

    it('releases hidden header space smoothly and settles exactly at zero', () => {
        const position = createFloatingSavePosition();
        position.update({ headerHeight: 52, viewportTop: 0 });
        let previous = 52;
        let result;
        for (let timestamp = 16; timestamp <= 320; timestamp += 16) {
            result = position.update({
                headerHeight: 0,
                viewportTop: 80,
                timestamp,
                animate: true,
            });
            expect(result.headerOffset).toBeLessThanOrEqual(previous);
            if (timestamp === 16) expect(result.headerOffset).toBeGreaterThan(0);
            previous = result.headerOffset;
        }
        expect(result.headerOffset).toBe(0);
        expect(result.needsAnimation).toBe(false);
    });

    it('follows viewport movement immediately while a header animation is still running', () => {
        const position = createFloatingSavePosition();
        position.update({ headerHeight: 52, viewportTop: 0 });
        const first = position.update({
            headerHeight: 0,
            viewportTop: 80,
            timestamp: 16,
            animate: true,
        });
        const second = position.update({
            headerHeight: 0,
            viewportTop: 140,
            timestamp: 32,
            animate: true,
        });
        expect(first.viewportTop).toBe(80);
        expect(second.viewportTop).toBe(140);
        expect(second.headerOffset).toBeLessThan(first.headerOffset);
        expect(second.needsAnimation).toBe(true);
    });

    it('aligns translations to physical pixels and ignores noise at a hidden header boundary', () => {
        const position = createFloatingSavePosition();
        position.update({ headerHeight: 0, viewportTop: 0 });
        for (const headerHeight of [0.2, 0.9, 0, 0.4]) {
            const result = position.update({
                headerHeight,
                viewportTop: 100.24,
                devicePixelRatio: 2,
                timestamp: 16,
                animate: true,
            });
            expect(result.headerOffset).toBe(0);
            expect(result.viewportTop).toBe(100);
            expect(result.needsAnimation).toBe(false);
        }
    });

    it('restores header space and snaps immediately when animation is disabled', () => {
        const position = createFloatingSavePosition();
        position.update({ headerHeight: 0, viewportTop: 80 });
        const restoring = position.update({
            headerHeight: 52,
            viewportTop: 0,
            timestamp: 16,
            animate: true,
        });
        expect(restoring.headerOffset).toBeGreaterThan(0);
        expect(restoring.headerOffset).toBeLessThan(52);
        const result = position.update({ headerHeight: 52, viewportTop: 0, animate: false });
        expect(result).toEqual({ headerOffset: 52, viewportTop: 0, needsAnimation: false });
    });
});
