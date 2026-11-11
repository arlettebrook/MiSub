import { describe, it, expect, vi } from 'vitest';
import { useSubscriptionForms } from '../../src/composables/useSubscriptionForms.js';

vi.mock('../../src/stores/toast.js', () => ({
    useToastStore: () => ({
        showToast: vi.fn(),
    }),
}));

describe('useSubscriptionForms', () => {
    it('新增机场订阅时默认使用默认 UA（customUserAgent 为空）', () => {
        const { openAdd, editingSubscription } = useSubscriptionForms({
            addSubscription: vi.fn(),
            updateSubscription: vi.fn(),
        });

        openAdd();

        expect(editingSubscription.value.customUserAgent).toBe('');
    });

    it('新增机场订阅时保护性缓存节点默认关闭', () => {
        const { openAdd, editingSubscription } = useSubscriptionForms({
            addSubscription: vi.fn(),
            updateSubscription: vi.fn(),
        });

        openAdd();

        expect(editingSubscription.value.enableNodeCache).toBe(false);
    });

    it.each(['Client/1.0\nExtra: bad', '\r\n', 'Client\u0000', '中文 UA', 42])(
        'keeps the form open and prevents both add and update for invalid UA (%j)',
        (customUserAgent) => {
            for (const isNew of [true, false]) {
                const addSubscription = vi.fn();
                const updateSubscription = vi.fn();
                const forms = useSubscriptionForms({ addSubscription, updateSubscription });
                if (isNew) forms.openAdd();
                else forms.openEdit({ id: 'sub', url: 'https://example.com/sub', customUserAgent });
                forms.editingSubscription.value.url = 'https://example.com/sub';
                forms.editingSubscription.value.customUserAgent = customUserAgent;
                forms.handleSave();
                expect(addSubscription).not.toHaveBeenCalled();
                expect(updateSubscription).not.toHaveBeenCalled();
                expect(forms.showModal.value).toBe(true);
            }
        }
    );

    it.each(['', 'clash-verge/v2.4.3', 'Custom/1.0 (Android; test)'])(
        'saves valid default and existing UA values without replacing them (%s)',
        (customUserAgent) => {
            const updateSubscription = vi.fn();
            const forms = useSubscriptionForms({ addSubscription: vi.fn(), updateSubscription });
            forms.openEdit({ id: 'sub', url: 'https://example.com/sub', customUserAgent });
            forms.handleSave();
            expect(updateSubscription).toHaveBeenCalledWith(
                expect.objectContaining({ customUserAgent })
            );
            expect(forms.showModal.value).toBe(false);
        }
    );
});
