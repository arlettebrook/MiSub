// Smooth header visibility changes independently of the keyboard's viewport movement.
export function createFloatingSavePosition() {
    let headerOffset = null;
    let headerTarget = 0;
    let lastFrameTime = null;

    return {
        update({ headerHeight, viewportTop, timestamp, devicePixelRatio = 1, animate = false }) {
            const target = headerHeight < 1 ? 0 : headerHeight;
            if (headerOffset === null || !animate) {
                headerOffset = headerTarget = target;
                lastFrameTime = null;
            } else {
                // Ignore small boundary fluctuations, but always release a fully hidden header.
                if (Math.abs(target - headerTarget) > 1 || target === 0) headerTarget = target;
                const elapsed =
                    lastFrameTime === null
                        ? 1000 / 60
                        : Math.max(0, Math.min(64, timestamp - lastFrameTime));
                headerOffset += (headerTarget - headerOffset) * (1 - Math.exp(-elapsed / 48));
                if (Math.abs(headerTarget - headerOffset) < 0.5) {
                    headerOffset = headerTarget;
                    lastFrameTime = null;
                } else {
                    lastFrameTime = timestamp;
                }
            }

            const pixelRatio = devicePixelRatio > 0 ? devicePixelRatio : 1;
            const roundToPixel = (value) => Math.round(value * pixelRatio) / pixelRatio;
            return {
                headerOffset: roundToPixel(headerOffset),
                viewportTop: roundToPixel(viewportTop),
                needsAnimation: headerOffset !== headerTarget,
            };
        },
    };
}
