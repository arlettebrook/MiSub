import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import Modal from '../../src/components/forms/Modal.vue';
import FormModal from '../../src/components/shared/FormModal.vue';
import QRCodeOverlay from '../../src/components/public/QRCodeOverlay.vue';
import ProfileGrid from '../../src/components/public/ProfileGrid.vue';
import SessionVerification from '../../src/components/ui/SessionVerification.vue';
import { createI18n } from '../../src/i18n/index.js';

const wrappers = [];
function open(component, props = {}, slots = {}) {
  const wrapper = mount(component, {
    props: {
      ...(component === QRCodeOverlay || component === ProfileGrid ? {} : { show: true }),
      ...props,
    },
    slots,
    attachTo: document.body,
    global: { plugins: [createI18n({ initialLocale: 'en-US' })] },
  });
  wrappers.push(wrapper);
  return wrapper;
}
function wheel(target, deltaY, deltaX = 0) {
  const event = new WheelEvent('wheel', { deltaY, deltaX, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}
function touch(target, type, y, count = 1) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, (_, identifier) => ({
      identifier,
      clientX: 10,
      clientY: y,
    })),
  });
  target.dispatchEvent(event);
  return event;
}
function scroller() {
  const element = document.querySelector('[data-testid="scroller"]');
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 400 },
  });
  return element;
}

beforeEach(() => {
  document.body.style.cssText = 'padding-right: 7px; color: red';
  document.documentElement.style.cssText = 'scroll-behavior: smooth';
  vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(480);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000);
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(985);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(async () => {
  wrappers
    .splice(0)
    .reverse()
    .forEach((wrapper) => wrapper.unmount());
  await nextTick();
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

describe('dialog background scroll locking', () => {
  it.each([
    [Modal, {}],
    [FormModal, { title: 'Edit' }],
    [QRCodeOverlay, { isExpanded: true, profile: { id: 'p1', name: 'Demo' } }],
    [SessionVerification, {}],
  ])(
    'locks the page for %s and restores its position and inline styles on unmount',
    async (component, props) => {
      const wrapper = open(component, props);
      await nextTick();
      expect(document.body.style.position).toBe('fixed');
      expect(document.body.style.top).toBe('-480px');
      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');
      expect(document.body.style.paddingRight).toBe('22px');
      wrapper.unmount();
      wrappers.pop();
      expect(document.body.style.position).toBe('');
      expect(document.body.style.paddingRight).toBe('7px');
      expect(document.body.style.color).toBe('red');
      expect(document.documentElement.style.scrollBehavior).toBe('smooth');
      expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 480, behavior: 'instant' });
    }
  );

  it.each([false, true])(
    'keeps the lock until the last layer closes, parent first: %s',
    async (parentFirst) => {
      const parent = open(Modal);
      const top = open(SessionVerification);
      await nextTick();
      const first = parentFirst ? parent : top;
      const last = parentFirst ? top : parent;
      await first.setProps({ show: false });
      expect(document.body.style.position).toBe('fixed');
      expect(window.scrollTo).not.toHaveBeenCalled();
      await last.setProps({ show: false });
      expect(document.body.style.position).toBe('');
      expect(window.scrollTo).toHaveBeenCalledOnce();
      expect(document.body.style.overflow).toBe('');
    }
  );

  it('does not lock when hidden, and releases after a rapid open/close', async () => {
    const wrapper = open(Modal, { show: false });
    expect(document.body.style.position).toBe('');
    await wrapper.setProps({ show: true });
    await wrapper.setProps({ show: false });
    expect(document.body.style.position).toBe('');
    expect(wheel(document.body, 100).defaultPrevented).toBe(false);
  });

  it('blocks backdrop and boundary wheel scrolling but preserves internal scrolling', async () => {
    open(
      Modal,
      {},
      { body: '<div data-testid="scroller" style="overflow-y:auto"><p>Content</p></div>' }
    );
    await nextTick();
    const element = scroller();
    expect(wheel(document.body, 100).defaultPrevented).toBe(true);
    expect(wheel(document.querySelector('[role="dialog"]'), 100).defaultPrevented).toBe(true);
    element.scrollTop = 100;
    expect(wheel(element, 100).defaultPrevented).toBe(false);
    element.scrollTop = 300;
    expect(wheel(element, 100).defaultPrevented).toBe(true);
    expect(wheel(element, -100).defaultPrevented).toBe(false);
    element.scrollTop = 0;
    expect(wheel(element, -100).defaultPrevented).toBe(true);
  });

  it('blocks touch panning on the backdrop and at boundaries, allowing scrolling and pinch zoom', async () => {
    open(Modal, {}, { body: '<div data-testid="scroller" style="overflow-y:auto">Content</div>' });
    await nextTick();
    const element = scroller();
    touch(document.body, 'touchstart', 200);
    expect(touch(document.body, 'touchmove', 100).defaultPrevented).toBe(true);
    element.scrollTop = 100;
    touch(element, 'touchstart', 200);
    expect(touch(element, 'touchmove', 100).defaultPrevented).toBe(false);
    element.scrollTop = 300;
    expect(touch(element, 'touchmove', 50).defaultPrevented).toBe(true);
    expect(touch(element, 'touchmove', 75, 2).defaultPrevented).toBe(false);
    const zoom = new WheelEvent('wheel', {
      deltaY: 100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(zoom, 'ctrlKey', { value: true });
    document.body.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
  });

  it('blocks an underlying modal when the session overlay is on top', async () => {
    open(Modal, {}, { body: '<div data-testid="scroller" style="overflow-y:auto">Content</div>' });
    await nextTick();
    const element = scroller();
    element.scrollTop = 100;
    const top = open(SessionVerification);
    await nextTick();
    // An inert ancestor suppresses dispatch in happy-dom; send a document-level
    // event with the original target to exercise the scroll guard itself.
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: element });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await top.setProps({ show: false });
    expect(wheel(element, 100).defaultPrevented).toBe(false);
  });

  it('allows a teleported scrollable menu owned by the current dialog', async () => {
    open(Modal, {}, { body: '<button aria-controls="popup">Open groups</button>' });
    await nextTick();
    const popup = document.createElement('div');
    popup.id = 'popup';
    popup.style.overflowY = 'auto';
    Object.defineProperties(popup, { clientHeight: { value: 100 }, scrollHeight: { value: 300 } });
    popup.scrollTop = 50;
    document.body.appendChild(popup);
    expect(wheel(popup, 100).defaultPrevented).toBe(false);
    popup.scrollTop = 200;
    expect(wheel(popup, 100).defaultPrevented).toBe(true);
    const top = open(SessionVerification);
    await nextTick();
    expect(wheel(popup, -100).defaultPrevented).toBe(true);
    await top.setProps({ show: false });
    expect(wheel(popup, -100).defaultPrevented).toBe(false);
  });

  it('preserves pre-existing important scroll styles and unrelated changes while open', async () => {
    document.body.style.setProperty('position', 'relative', 'important');
    document.body.style.setProperty('overflow', 'auto', 'important');
    const wrapper = open(Modal);
    await nextTick();
    document.body.style.color = 'blue';
    await wrapper.setProps({ show: false });
    expect(document.body.style.position).toBe('relative');
    expect(document.body.style.getPropertyPriority('position')).toBe('important');
    expect(document.body.style.overflow).toBe('auto');
    expect(document.body.style.getPropertyPriority('overflow')).toBe('important');
    expect(document.body.style.color).toBe('blue');
  });

  it('opens one public QR overlay when the mobile and desktop cards share a single profile', async () => {
    open(ProfileGrid, {
      profiles: [{ id: 'p1', name: 'Demo' }],
      isQrExpanded: () => true,
    });
    await vi.dynamicImportSettled();
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
