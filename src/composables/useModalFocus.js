import { computed, nextTick, onScopeDispose, shallowRef, watch } from 'vue';
import { lockModalScroll } from '../utils/modal-scroll-lock.js';

const layers = shallowRef([]);
const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function topLayer() {
    return layers.value.reduce(
        (top, layer) => (!top || layer.priority() >= top.priority() ? layer : top),
        null
    );
}

function canFocus(element) {
    if (!element || typeof element.focus !== 'function' || element.disabled) return false;
    if (element.closest('[hidden], [inert]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function focusableElements(layer) {
    return Array.from(layer.panel.value?.querySelectorAll(FOCUSABLE) || []).filter(canFocus);
}

function focusLayer(layer) {
    const preferred = layer.preferredFocus?.();
    const target = canFocus(preferred)
        ? preferred
        : focusableElements(layer)[0] || layer.panel.value;
    target?.focus({ preventScroll: true });
}

export function useModalFocus(panel, show, options = {}) {
    const layer = {
        panel,
        priority: options.priority || (() => 0),
        preferredFocus: options.preferredFocus,
        previousFocus: null,
    };
    let registered = false;
    let releaseScroll = null;
    const isTopModal = computed(() => layers.value.includes(layer) && topLayer() === layer);

    function handleKeydown(event) {
        if (!show() || !isTopModal.value || event.defaultPrevented || event.isComposing) return;
        if (event.key === 'Escape') {
            options.onEscape?.();
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (event.key !== 'Tab') return;
        const elements = focusableElements(layer);
        const first = elements[0];
        const last = elements.at(-1);
        const active = document.activeElement;
        if (!first) {
            event.preventDefault();
            panel.value?.focus();
        } else if (!panel.value?.contains(active) || active === panel.value) {
            event.preventDefault();
            (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    }

    function closeLayer() {
        if (!registered) return;
        const wasTop = topLayer() === layer;
        registered = false;
        // Preserve the original trigger when an underlying dialog disappears first.
        for (const other of layers.value) {
            if (other !== layer && panel.value?.contains(other.previousFocus)) {
                other.previousFocus = layer.previousFocus;
            }
        }
        layers.value = layers.value.filter((item) => item !== layer);
        releaseScroll?.();
        releaseScroll = null;
        window.removeEventListener('keydown', handleKeydown);
        if (wasTop) {
            void nextTick().then(() => {
                const top = topLayer();
                if (top) {
                    if (
                        top.panel.value?.contains(layer.previousFocus) &&
                        canFocus(layer.previousFocus)
                    ) {
                        layer.previousFocus.focus({ preventScroll: true });
                    } else {
                        focusLayer(top);
                    }
                } else if (layer.previousFocus?.isConnected && canFocus(layer.previousFocus)) {
                    layer.previousFocus.focus({ preventScroll: true });
                }
            });
        }
    }

    watch(
        show,
        async (visible) => {
            if (!visible) return closeLayer();
            if (registered || typeof window === 'undefined') return;
            registered = true;
            layer.previousFocus = document.activeElement;
            layers.value = [...layers.value, layer];
            releaseScroll = lockModalScroll(() => {
                const panel = topLayer()?.panel.value;
                return panel?.closest('[data-modal-scroll-root]') || panel;
            });
            window.addEventListener('keydown', handleKeydown);
            await nextTick();
            if (registered && show() && isTopModal.value) focusLayer(layer);
        },
        { immediate: true }
    );
    onScopeDispose(closeLayer);
    return { isTopModal };
}
