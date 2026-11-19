export function bindWorkspacePages(viewport, tabList, onSelect) {
  const tabs = [...tabList.querySelectorAll('[role="tab"]')];
  const panels = [...viewport.children];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;
  let touchActive = false;
  let settleTimer = 0;

  function select(index, focus = false) {
    if (index !== current) {
      // Move focus before deactivating a panel so it is never left inside an inert page.
      if (panels[current].contains(document.activeElement)) focus = true;
      current = index;
      for (const [i, tab] of tabs.entries()) {
        const selected = i === index;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) {
          panels[i].removeAttribute('aria-hidden');
          panels[i].removeAttribute('inert');
        }
      }
      if (focus) tabs[index].focus({preventScroll: true});
      for (const [i, panel] of panels.entries()) {
        if (i === index) continue;
        panel.setAttribute('aria-hidden', 'true');
        panel.setAttribute('inert', '');
      }
      onSelect(tabs[index].dataset.page);
    } else if (focus) {
      tabs[index].focus({preventScroll: true});
    }
  }

  function align() {
    clearTimeout(settleTimer);
    viewport.scrollTo({left: viewport.clientWidth * current, behavior: 'auto'});
  }

  function open(page, {animate = true, focus = false} = {}) {
    const index = tabs.findIndex(tab => tab.dataset.page === page);
    if (index < 0) return;
    clearTimeout(settleTimer);
    select(index, focus);
    viewport.scrollTo({
      left: viewport.clientWidth * index,
      behavior: animate && !reducedMotion.matches ? 'smooth' : 'auto'
    });
  }

  function settle() {
    clearTimeout(settleTimer);
    if (touchActive || !viewport.clientWidth) return;
    const index = Math.max(0, Math.min(tabs.length - 1, Math.round(viewport.scrollLeft / viewport.clientWidth)));
    select(index);
    if (Math.abs(viewport.scrollLeft - index * viewport.clientWidth) > 2) align();
  }

  function queueSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 140);
  }

  viewport.addEventListener('scroll', queueSettle, {passive: true});
  viewport.addEventListener('scrollend', settle);
  viewport.addEventListener('touchstart', () => { touchActive = true; }, {passive: true});
  for (const type of ['touchend', 'touchcancel']) {
    viewport.addEventListener(type, event => {
      touchActive = event.touches.length > 0;
      if (!touchActive) queueSettle();
    }, {passive: true});
  }
  window.addEventListener('resize', align);
  for (const tab of tabs) {
    tab.addEventListener('click', () => open(tab.dataset.page, {focus: true}));
  }
  tabList.addEventListener('keydown', event => {
    const indices = {ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: tabs.length - 1};
    if (!Object.prototype.hasOwnProperty.call(indices, event.key)) return;
    event.preventDefault();
    const index = (indices[event.key] + tabs.length) % tabs.length;
    if (!tabs[index].disabled) open(tabs[index].dataset.page, {focus: true});
  });
  return {open, align};
}
