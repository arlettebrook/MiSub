import { mount, RouterLinkStub } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Login from '../../src/components/modals/Login.vue';
import BrandLogo from '../../src/components/layout/BrandLogo.vue';

describe('login logo', () => {
    it.each([
        { name: 'login card', component: Login },
        { name: 'page header', component: BrandLogo },
    ])('renders $name without requesting protected branding assets', ({ component }) => {
        const wrapper = mount(component, { global: { stubs: { RouterLink: RouterLinkStub } } });
        const source = wrapper.get('img[alt="MiSub"]').attributes('src');
        expect(source).toMatch(/^data:image\/png;base64,/);
        const png = Buffer.from(source.split(',')[1], 'base64');
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        // 2x resolution for the 96px display, with a small embedded payload.
        expect(png.readUInt32BE(16)).toBe(192);
        expect(png.readUInt32BE(20)).toBe(192);
        expect(png.length).toBeLessThan(50000);
        wrapper.unmount();
    });
});
