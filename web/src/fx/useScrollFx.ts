// Scroll-linked motion with GSAP + ScrollTrigger, loaded only by the pages that use it.
// Everything is scoped to `root` and reverted on unmount. Under prefers-reduced-motion nothing
// runs: the content is complete and static without it (motion only adds emphasis).
import { type RefObject, useLayoutEffect } from 'react';

type Gsap = typeof import('gsap').gsap;
type Trigger = typeof import('gsap/ScrollTrigger').ScrollTrigger;

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Space taken at the top by the sticky site header (px), so pinned content never hides under it. */
export function headerOffset(): number {
  const bar = document.querySelector<HTMLElement>('.topbar');
  if (!bar) return 16;
  const pos = getComputedStyle(bar).position;
  return (pos === 'sticky' || pos === 'fixed' ? bar.offsetHeight : 0) + 16;
}

export function useScrollFx(root: RefObject<HTMLElement | null>, build: (gsap: Gsap, st: Trigger) => void, deps: unknown[] = []) {
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    let alive = true, revert = () => {};
    Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (!alive) return;
      gsap.registerPlugin(ScrollTrigger);
      el.classList.add('sfx-on');
      const ctx = gsap.context(() => build(gsap, ScrollTrigger), el);
      // late images and fonts change heights: measure again once they settle
      const refresh = () => ScrollTrigger.refresh();
      window.addEventListener('load', refresh);
      document.fonts?.ready.then(() => alive && refresh());
      revert = () => { window.removeEventListener('load', refresh); ctx.revert(); el.classList.remove('sfx-on'); };
    }).catch(() => {});
    return () => { alive = false; revert(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
