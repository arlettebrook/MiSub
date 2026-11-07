import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import Button from '../../src/components/ui/Button.vue';
import Input from '../../src/components/ui/Input.vue';
import Switch from '../../src/components/ui/Switch.vue';
import Toast from '../../src/components/ui/Toast.vue';
import { createI18n } from '../../src/i18n/index.js';
import { useToastStore } from '../../src/stores/toast.js';

afterEach(() => vi.useRealTimers());

describe('accessible UI controls', () => {
  it('preserves the visible button name and supports explicit icon labels', () => {
    const wrapper = mount(Button, { slots: { default: 'Save changes' } });
    expect(wrapper.get('button').attributes('aria-label')).toBeUndefined();
    expect(wrapper.text()).toBe('Save changes');
    const icon = mount(Button, { props: { iconOnly: true, ariaLabel: 'Delete node' } });
    expect(icon.get('button').attributes('aria-label')).toBe('Delete node');
  });

  it('associates input errors with the control and clears its invalid state', async () => {
    const wrapper = mount(Input, {
      props: { label: 'Subscription URL', error: 'Enter a valid URL' },
      attrs: { 'aria-describedby': 'url-hint', 'aria-label': 'Custom URL label' },
    });
    const input = wrapper.get('input');
    const error = wrapper.get('p');
    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'));
    expect(input.attributes('aria-label')).toBe('Custom URL label');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(input.attributes('aria-describedby').split(' ')).toContain(error.attributes('id'));
    expect(input.attributes('aria-describedby').split(' ')).toContain('url-hint');
    await wrapper.setProps({ error: '' });
    expect(input.attributes('aria-invalid')).toBe('false');
    expect(input.attributes('aria-describedby')).toBe('url-hint');
  });

  it('passes the accessible name to the switch input and preserves native toggling', async () => {
    const wrapper = mount(Switch, {
      props: { modelValue: false },
      attrs: { 'aria-label': 'Enable access logs' },
    });
    const input = wrapper.get('input');
    expect(input.attributes('aria-label')).toBe('Enable access logs');
    await input.setValue(true);
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]]);
    await wrapper.setProps({ disabled: true });
    expect(input.element.disabled).toBe(true);
    await input.trigger('change');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('announces errors urgently and other notifications politely with translated dismissals', async () => {
    vi.useFakeTimers();
    const pinia = createPinia();
    const locale = createI18n({ initialLocale: 'en-US' });
    const store = useToastStore(pinia);
    store.showToast('Saved successfully', 'success');
    store.showToast('Save failed', 'error');
    const wrapper = mount(Toast, { global: { plugins: [pinia, locale] } });
    expect(wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite');
    const error = wrapper.get('[role="alert"]');
    expect(error.attributes('aria-live')).toBe('assertive');
    expect(error.attributes('aria-atomic')).toBe('true');
    expect(error.get('button').attributes('aria-label')).toBe(locale.t('common.toastClose'));
    await error.get('button').trigger('click');
    expect(store.toasts.map((toast) => toast.message)).toEqual(['Saved successfully']);
    wrapper.unmount();
  });
});
