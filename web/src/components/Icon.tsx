// Line icons drawn in-house (24 px grid, 1.75 stroke, currentColor), so the UI needs no emoji
// and no icon dependency. Decorative by default; pass `title` when the icon is the only label.
import type { ReactNode } from 'react';

const PATHS = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
  earth: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" /></>,
  moon: <><circle cx="12" cy="12" r="9.5" /><circle cx="9" cy="9.5" r="1.8" /><circle cx="15" cy="14.5" r="2.3" /><circle cx="15.5" cy="7.5" r="1" /><circle cx="8.5" cy="16" r="0.9" /></>,
  thermometer: <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0ZM12 9v6.5" />,
  scan: <><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><circle cx="12" cy="12" r="3.5" /><path d="m14.5 14.5 2.5 2.5" /></>,
  pin: <><path d="M20 10c0 5-8 12-8 12s-8-7-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  compass: <><circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36Z" /></>,
  mountain: <path d="M2 20 9 7l4 7 2.5-3.5L22 20Z" />,
  rocket: <><path d="M12 2c3 2.2 4.5 5.8 4.5 9.5L15 16H9l-1.5-4.5C7.5 7.8 9 4.2 12 2Z" /><circle cx="12" cy="9" r="1.6" /><path d="M9 16l-2.5 4 3.5-1.2M15 16l2.5 4-3.5-1.2M12 18v3.5" /></>,
  scale: <><path d="M12 3v18M7 21h10M4 7h16" /><path d="m7 7-3 7a3 3 0 0 0 6 0ZM17 7l-3 7a3 3 0 0 0 6 0Z" /></>,
  timer: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M10 2h4M19 6l-1.4 1.4" /></>,
  checkCircle: <><circle cx="12" cy="12" r="10" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4.5M12 8h.01" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 12 0v1M16 4.13a4 4 0 0 1 0 7.75M22 21v-1a6 6 0 0 0-4-5.65" /></>,
  maximize: <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />,
  mouse: <><rect x="6" y="3" width="12" height="18" rx="6" /><path d="M12 7v4" /></>,
  arrowDown: <path d="M12 5v14M19 12l-7 7-7-7" />,
  arrowUp: <path d="M12 19V5M5 12l7-7 7 7" />,
  target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  play: <path d="M7 4.5v15l12-7.5Z" />,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  exit: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  rotate: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  dot: <circle cx="12" cy="12" r="5" />,
  navigation: <path d="m12 2 7 19-7-4-7 4Z" />,
  award: <><circle cx="12" cy="9" r="6" /><path d="m8.5 14 -1.5 8 5-3 5 3-1.5-8" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, size = 16, title, className }: { name: IconName; size?: number; title?: string; className?: string }) {
  return (
    <svg className={`icon${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}
      aria-label={title} focusable="false">
      {PATHS[name]}
    </svg>
  );
}
