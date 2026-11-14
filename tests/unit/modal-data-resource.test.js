import { describe, expect, it, vi } from 'vitest';
import { createModalDataResource } from '../../src/utils/modal-data.js';

describe('dialog data resource', () => {
    it('shares pending work and caches only within the success TTL', async () => {
        let time = 0,
            finish;
        const resource = createModalDataResource({ ttl: 100, now: () => time });
        const descriptor = {
            key: 'one',
            load: vi
                .fn()
                .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
                .mockResolvedValue('updated'),
        };
        const first = resource.read(descriptor);
        expect(resource.read(descriptor)).toBe(first);
        finish('data');
        await first.promise;
        resource.cancel();
        time = 99;
        expect(resource.read(descriptor).data).toBe('data');
        expect(descriptor.load).toHaveBeenCalledOnce();
        time = 100;
        await resource.read(descriptor).promise;
        expect(descriptor.load).toHaveBeenCalledTimes(2);
    });

    it('discards the old source instead of caching several sources', async () => {
        const resource = createModalDataResource({ ttl: 1_000 });
        const first = { key: 'one', load: vi.fn(async () => 'one') };
        const second = { key: 'two', load: vi.fn(async () => 'two') };
        await resource.read(first).promise;
        resource.cancel();
        await resource.read(second).promise;
        resource.cancel();
        await resource.read(first).promise;
        expect(first.load).toHaveBeenCalledTimes(2);
    });

    it('keeps errors for the current opening, while cancellation permits retry and partial results are not cached', async () => {
        const resource = createModalDataResource({ ttl: 1_000, accepts: (data) => !data.partial });
        const descriptor = {
            key: 'one',
            load: vi
                .fn()
                .mockRejectedValueOnce(new Error('Offline'))
                .mockResolvedValue({ partial: true }),
        };
        await expect(resource.read(descriptor).promise).rejects.toThrow('Offline');
        await expect(resource.read(descriptor).promise).rejects.toThrow('Offline');
        expect(descriptor.load).toHaveBeenCalledOnce();
        resource.cancel();
        await resource.read(descriptor).promise;
        resource.cancel();
        await resource.read(descriptor).promise;
        expect(descriptor.load).toHaveBeenCalledTimes(3);
    });
});
