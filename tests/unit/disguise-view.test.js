import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia } from 'pinia';
import DisguiseView from '../../src/views/DisguiseView.vue';
import { useSessionStore } from '../../src/stores/session.js';

let wrapper;
let replace;

beforeEach(() => {
    replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
});

afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
});

async function openDisguise(disguise, state = 'loggedOut') {
    const pinia = createPinia();
    const session = useSessionStore(pinia);
    session.sessionState = state;
    session.loginPath = '/admin-secret';
    session.publicConfig = { enablePublicPage: false, disguise };
    wrapper = mount(DisguiseView, { global: { plugins: [pinia] } });
    await flushPromises();
    return session;
}

describe('configured disguise rendering', () => {
    it('renders the server disguise page without a login form or management entry', async () => {
        await openDisguise({ enabled: true, pageType: 'default' });
        const frame = wrapper.find('[data-testid="disguise-frame"]');
        expect(frame.exists()).toBe(true);
        expect(frame.attributes('srcdoc')).toContain('页面未找到');
        expect(frame.attributes('srcdoc')).toContain('404');
        expect(frame.attributes('srcdoc')).not.toContain('admin-secret');
        expect(frame.attributes('srcdoc')).not.toContain('<form');
        expect(replace).not.toHaveBeenCalled();
    });

    it('navigates to the configured disguise target instead of the remembered login entry', async () => {
        await openDisguise({
            enabled: true,
            pageType: 'redirect',
            redirectUrl: 'example.org/cover',
        });
        expect(replace).toHaveBeenCalledExactlyOnceWith('https://example.org/cover');
        expect(wrapper.find('[data-testid="disguise-frame"]').exists()).toBe(false);
    });

    it.each([
        { enabled: false, pageType: 'redirect', redirectUrl: 'https://example.org/' },
        { enabled: true, pageType: 'redirect', redirectUrl: 'javascript:alert(1)' },
    ])('falls back to 404 when a redirect is disabled or invalid (%j)', async (config) => {
        await openDisguise(config);
        expect(replace).not.toHaveBeenCalled();
        expect(wrapper.find('[data-testid="disguise-frame"]').attributes('srcdoc')).toContain(
            '404'
        );
    });

    it('waits for session validation and does not redirect an authenticated visitor', async () => {
        const session = await openDisguise(
            { enabled: true, pageType: 'redirect', redirectUrl: 'https://example.org/' },
            'loading'
        );
        expect(replace).not.toHaveBeenCalled();
        session.sessionState = 'loggedIn';
        await flushPromises();
        expect(replace).not.toHaveBeenCalled();
        expect(wrapper.find('iframe').exists()).toBe(false);
    });
});
