import { useEffect, useRef, useState } from 'react';

const NUM = /^([+\-−]?)(\d+(?:[.,]\d+)?)$/;

/**
 * Animates a numeric string from its previous value to the new one (easeOutCubic, 700 ms).
 * Non-numeric values render as-is. Screen readers get the final value only.
 */
export default function CountUp({ value, className }: { value: string; className?: string }) {
  const m = value.match(NUM);
  const target = m ? Number(m[2].replace(',', '.')) * (m[1] === '-' || m[1] === '−' ? -1 : 1) : NaN;
  const decimals = m && m[2].includes('.') ? m[2].split('.')[1].length : 0;
  const from = useRef(0);
  const [shown, setShown] = useState(Number.isFinite(target) ? 0 : NaN);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(target); from.current = target; return; }
    const start = performance.now(), a = from.current, ms = 700;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - k, 3);
      setShown(a + (target - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);

  if (!m) return <span className={className}>{value}</span>;
  const sign = shown < 0 ? '−' : m[1] ? '+' : '';
  const text = sign + Math.abs(shown).toFixed(decimals);
  return (
    <span className={className}>
      <span aria-hidden>{text}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
