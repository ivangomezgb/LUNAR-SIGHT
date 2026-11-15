// Keyboard mapping for the game. Matched by physical key (`code`) first, so W A S D work on any
// layout and with Caps Lock, then by the character as a fallback.
export type Action = 'up' | 'down' | 'left' | 'right' | 'thrust';

const BY_CODE: Record<string, Action> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'thrust',
};
const BY_KEY: Record<string, Action> = {
  w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'thrust', spacebar: 'thrust',
};

/** Movement action of a key event, or null. Shortcuts with Ctrl/Alt/Meta are left to the browser. */
export function actionOf(e: { code?: string; key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): Action | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  return (e.code && BY_CODE[e.code]) || BY_KEY[e.key.toLowerCase()] || null;
}

/** −1 slower / +1 faster time warp: [ ] or − + (the brackets need AltGr on Spanish keyboards). */
export function warpStepOf(e: { code?: string; key: string }): -1 | 0 | 1 {
  if (e.key === '[' || e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') return -1;
  if (e.key === ']' || e.key === '+' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') return 1;
  return 0;
}

/** Letter shortcut by physical key (KeyE → 'e'), falling back to the character. */
export function letterOf(e: { code?: string; key: string }): string {
  return e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
}

/** True while the player is typing in a text field (game keys must not steal those). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('textarea, select, [contenteditable="true"]')) return true;
  const input = target.closest('input');
  return !!input && !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(input.type);
}
