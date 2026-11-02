import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

const BOTTOM_TOLERANCE = 4;
const REVEAL_DISTANCE = 40;
const WHEEL_GESTURE_GAP = 240;

export function useFooterReveal(resetKey) {
    const footer = ref(null);
    const isRevealed = ref(false);
    let mounted = false;
    let generation = 0;
    let reachedBottom = false;
    let touch = null;
    let wheel = null;

    const documentHeight = () =>
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const atBottom = () =>
        window.scrollY + window.innerHeight >= documentHeight() - BOTTOM_TOLERANCE;

    const reset = () => {
        generation++;
        isRevealed.value = false;
        reachedBottom = false;
        touch = null;
        wheel = null;
    };

    const blockedTarget = (target) => {
        const bodyStyle = getComputedStyle(document.body);
        if (bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden') return true;
        let element = target instanceof Element ? target : document.body;
        if (
            element.closest(
                '[role="dialog"], input, textarea, select, [contenteditable="true"], .mobile-nav-glass'
            )
        ) {
            return true;
        }
        while (element && element !== document.body && element !== document.documentElement) {
            const overflow = getComputedStyle(element).overflowY;
            if (
                ['auto', 'scroll'].includes(overflow) &&
                element.scrollHeight > element.clientHeight + BOTTOM_TOLERANCE
            ) {
                return true;
            }
            element = element.parentElement;
        }
        return false;
    };

    const reveal = async (focus = false) => {
        if (isRevealed.value) return;
        const currentGeneration = generation;
        isRevealed.value = true;
        await nextTick();
        if (!mounted || !isRevealed.value || currentGeneration !== generation) return;
        window.scrollTo({
            top: documentHeight(),
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
        });
        if (focus) footer.value?.focus({ preventScroll: true });
    };

    const onScroll = () => {
        if (isRevealed.value) {
            const element = footer.value;
            if (!element) return;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const occupiedHeight =
                rect.height +
                (parseFloat(style.marginTop) || 0) +
                (parseFloat(style.marginBottom) || 0);
            const collapsedBottom = documentHeight() - occupiedHeight - window.innerHeight;
            // Collapse only after it has left the viewport, without clamping the scroll position.
            if (rect.top >= window.innerHeight && window.scrollY < collapsedBottom - 16) reset();
            return;
        }
        reachedBottom = atBottom();
    };

    const onTouchStart = (event) => {
        touch = null;
        if (isRevealed.value || event.touches.length !== 1 || blockedTarget(event.target)) return;
        const point = event.touches[0];
        touch = {
            x: point.clientX,
            y: point.clientY,
            dx: 0,
            dy: 0,
            startedAtBottom: reachedBottom && atBottom(),
        };
    };

    const onTouchMove = (event) => {
        if (event.touches.length !== 1) {
            touch = null;
            return;
        }
        if (!touch) return;
        touch.dx = event.touches[0].clientX - touch.x;
        touch.dy = touch.y - event.touches[0].clientY;
    };

    const onTouchEnd = () => {
        const gesture = touch;
        touch = null;
        if (!gesture || gesture.dy <= 0 || Math.abs(gesture.dx) >= gesture.dy) return;
        if (gesture.startedAtBottom && atBottom() && gesture.dy >= REVEAL_DISTANCE) {
            void reveal();
        } else if (atBottom()) {
            reachedBottom = true;
        }
    };

    const onTouchCancel = () => {
        touch = null;
    };

    const onWheel = (event) => {
        if (
            isRevealed.value ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            blockedTarget(event.target) ||
            Math.abs(event.deltaX) > Math.abs(event.deltaY)
        )
            return;
        const now = Date.now();
        if (!wheel || now - wheel.time > WHEEL_GESTURE_GAP) {
            wheel = { time: now, distance: 0, startedAtBottom: reachedBottom && atBottom() };
        }
        wheel.time = now;
        const multiplier =
            event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
        wheel.distance = Math.max(0, wheel.distance + event.deltaY * multiplier);
        // Inertia from the gesture that first reaches the bottom cannot reveal the footer.
        if (
            event.deltaY > 0 &&
            wheel.startedAtBottom &&
            atBottom() &&
            wheel.distance >= REVEAL_DISTANCE
        ) {
            void reveal();
        } else if (event.deltaY > 0 && atBottom()) {
            reachedBottom = true;
        }
    };

    const onKeyDown = (event) => {
        if (
            event.repeat ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey ||
            event.shiftKey ||
            !['End', 'PageDown', 'ArrowDown', ' '].includes(event.key) ||
            blockedTarget(event.target)
        )
            return;
        if (event.target instanceof Element && event.target.closest('button, a')) return;
        if (!isRevealed.value && atBottom()) {
            if (reachedBottom) void reveal(true);
            else reachedBottom = true;
        }
    };

    const listeners = {
        scroll: onScroll,
        wheel: onWheel,
        touchstart: onTouchStart,
        touchmove: onTouchMove,
        touchend: onTouchEnd,
        touchcancel: onTouchCancel,
        keydown: onKeyDown,
        pagehide: reset,
    };

    watch(resetKey, reset, { flush: 'sync' });
    onMounted(() => {
        mounted = true;
        reachedBottom = window.scrollY > 0 && atBottom();
        for (const [name, listener] of Object.entries(listeners)) {
            window.addEventListener(name, listener, { passive: true });
        }
    });
    onUnmounted(() => {
        mounted = false;
        reset();
        for (const [name, listener] of Object.entries(listeners)) {
            window.removeEventListener(name, listener);
        }
    });

    return { footer, isRevealed };
}
