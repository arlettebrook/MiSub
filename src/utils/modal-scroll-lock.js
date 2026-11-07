const owners = new Set();
let savedStyles = [];
let savedPosition = null;
let activeRoot = null;
let gesture = null;

function setLockedStyles(element, values) {
  const style = element.style;
  for (const [property, value] of Object.entries(values)) {
    savedStyles.push({
      style,
      property,
      value: style.getPropertyValue(property),
      priority: style.getPropertyPriority(property),
    });
    style.setProperty(property, value, 'important');
  }
}

function scrollBoundary(target) {
  const root = activeRoot?.();
  if (!root) return null;
  if (root.contains(target)) return root;
  // Group selectors and menus can be teleported outside the modal's DOM tree.
  for (const trigger of root.querySelectorAll('[aria-controls]')) {
    for (const id of trigger.getAttribute('aria-controls').split(/\s+/)) {
      const popup = document.getElementById(id);
      if (popup?.contains(target)) return popup;
    }
  }
  return null;
}

function canScroll(target, deltaX, deltaY) {
  if (!target || !(deltaX || deltaY)) return false;
  const boundary = scrollBoundary(target);
  if (!boundary) return false;
  const vertical = Math.abs(deltaY) >= Math.abs(deltaX);
  const delta = vertical ? deltaY : deltaX;
  let element = target.nodeType === 1 ? target : target.parentElement;
  while (element) {
    const style = getComputedStyle(element);
    const overflow = vertical
      ? style.overflowY || style.overflow
      : style.overflowX || style.overflow;
    const position = vertical ? element.scrollTop : element.scrollLeft;
    const extent = vertical
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;
    if (/^(auto|scroll|overlay)$/.test(overflow) && extent > 1) {
      if ((delta < 0 && position > 0) || (delta > 0 && position < extent - 1)) return true;
    }
    if (element === boundary) break;
    element = element.parentElement;
  }
  return false;
}

function handleWheel(event) {
  if (event.ctrlKey || event.defaultPrevented) return;
  const deltaX = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
  const deltaY = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
  if ((deltaX || deltaY) && !canScroll(event.target, deltaX, deltaY)) event.preventDefault();
}

function handleTouchStart(event) {
  const touch = event.touches.length === 1 ? event.touches[0] : null;
  gesture = touch
    ? { identifier: touch.identifier, x: touch.clientX, y: touch.clientY, target: event.target }
    : null;
}

function handleTouchMove(event) {
  if (!gesture || event.touches.length !== 1 || event.defaultPrevented) return;
  const touch = event.touches[0];
  if (touch.identifier !== gesture.identifier) return;
  const deltaX = gesture.x - touch.clientX;
  const deltaY = gesture.y - touch.clientY;
  gesture.x = touch.clientX;
  gesture.y = touch.clientY;
  if ((deltaX || deltaY) && !canScroll(gesture.target, deltaX, deltaY)) event.preventDefault();
}

function handleTouchEnd() {
  gesture = null;
}

export function lockModalScroll(getActiveRoot) {
  if (typeof document === 'undefined' || !document.body) return () => {};
  const owner = Symbol();
  if (owners.size === 0) {
    activeRoot = getActiveRoot;
    const body = document.body;
    const root = document.documentElement;
    savedPosition = { left: window.scrollX, top: window.scrollY };
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    setLockedStyles(body, {
      position: 'fixed',
      top: `${-savedPosition.top}px`,
      left: `${-savedPosition.left}px`,
      width: '100%',
      'box-sizing': 'border-box',
      overflow: 'hidden',
      ...(scrollbarWidth ? { 'padding-right': `${padding + scrollbarWidth}px` } : {}),
    });
    setLockedStyles(root, {
      overflow: 'hidden',
      'overscroll-behavior': 'none',
      'scroll-behavior': 'auto',
    });
    document.addEventListener('wheel', handleWheel, { capture: true, passive: false });
    document.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', handleTouchEnd, true);
    document.addEventListener('touchcancel', handleTouchEnd, true);
  }
  owners.add(owner);
  return () => {
    if (!owners.delete(owner) || owners.size > 0) return;
    document.removeEventListener('wheel', handleWheel, true);
    document.removeEventListener('touchstart', handleTouchStart, true);
    document.removeEventListener('touchmove', handleTouchMove, true);
    document.removeEventListener('touchend', handleTouchEnd, true);
    document.removeEventListener('touchcancel', handleTouchEnd, true);
    // Keep restoration instant even if the site normally uses smooth scrolling.
    const rootScrollStyle = savedStyles.find((entry) => entry.property === 'scroll-behavior');
    for (const entry of savedStyles.filter((entry) => entry !== rootScrollStyle).reverse()) {
      if (entry.value) entry.style.setProperty(entry.property, entry.value, entry.priority);
      else entry.style.removeProperty(entry.property);
    }
    window.scrollTo({ ...savedPosition, behavior: 'instant' });
    if (rootScrollStyle.value)
      rootScrollStyle.style.setProperty(
        rootScrollStyle.property,
        rootScrollStyle.value,
        rootScrollStyle.priority
      );
    else rootScrollStyle.style.removeProperty(rootScrollStyle.property);
    savedStyles = [];
    savedPosition = null;
    activeRoot = null;
    gesture = null;
  };
}
