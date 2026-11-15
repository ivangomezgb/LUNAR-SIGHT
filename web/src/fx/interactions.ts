// Delegated micro-interactions, installed once for the whole app:
//  - pointer light on cards (--mx/--my), magnetic primary buttons (--magx/--magy)
//  - scroll reveal: matching elements fade/rise in once as they enter the viewport
// Nothing runs under prefers-reduced-motion or on touch-only devices where it adds nothing.

const REVEAL = '.card, .metric, .page-head, .start-grid > *, .site-header, .compare-cols > *, .ranking li, .about-grid > *';
const MAGNETIC = '.btn-primary, .hero-actions .btn';
const LIGHT = '.card, .metric';

export function installFx(): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const cleanups: Array<() => void> = [];

  if (fine && !reduced) {
    let magnet: HTMLElement | null = null;
    const move = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const lit = target?.closest<HTMLElement>(LIGHT);
      if (lit) {
        const r = lit.getBoundingClientRect();
        lit.style.setProperty('--mx', `${e.clientX - r.left}px`);
        lit.style.setProperty('--my', `${e.clientY - r.top}px`);
      }
      const m = target?.closest<HTMLElement>(MAGNETIC) ?? null;
      if (magnet && magnet !== m) { magnet.style.removeProperty('--magx'); magnet.style.removeProperty('--magy'); }
      magnet = m;
      if (m) {
        const r = m.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        m.style.setProperty('--magx', `${(dx * 8).toFixed(1)}px`);
        m.style.setProperty('--magy', `${(dy * 6).toFixed(1)}px`);
      }
    };
    const leave = (e: PointerEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.matches(LIGHT)) { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); }
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', leave, { passive: true });
    cleanups.push(() => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerout', leave); });
  }

  if (!reduced && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('fx-ready');
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('rv-in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    const scan = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (el.classList.contains('rv') || el.closest('.game, .preloader, .expedition-viewer')) return;
        const siblings = el.parentElement ? Array.from(el.parentElement.children).indexOf(el) : 0;
        el.style.setProperty('--rv-delay', `${Math.min(siblings, 6) * 70}ms`);
        el.classList.add('rv');
        io.observe(el);
      });
    };
    scan(document);
    const mo = new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach((n) => { if (n instanceof Element) scan(n.parentNode ?? n); }); });
    mo.observe(document.body, { childList: true, subtree: true });
    cleanups.push(() => { io.disconnect(); mo.disconnect(); document.documentElement.classList.remove('fx-ready'); });
  }
  return () => cleanups.forEach((c) => c());
}
