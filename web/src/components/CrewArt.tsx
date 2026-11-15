// Apolo404 illustrations drawn in SVG: the mission patch and a crew character per member.
// Decorative; names and facts live in the page text.

/** Circular mission patch with the team name around the rim. */
export function MissionPatch({ size = 260 }: { size?: number }) {
  return (
    <svg className="patch" width={size} height={size} viewBox="0 0 260 260" aria-hidden>
      <defs>
        <radialGradient id="patch-bg" cx="50%" cy="38%" r="70%"><stop offset="0" stopColor="#123a78" /><stop offset="1" stopColor="#050b18" /></radialGradient>
        <radialGradient id="patch-moon" cx="40%" cy="30%" r="75%"><stop offset="0" stopColor="#f2f4f8" /><stop offset="1" stopColor="#8d96a6" /></radialGradient>
        <radialGradient id="patch-earth" cx="35%" cy="35%" r="70%"><stop offset="0" stopColor="#8cc4ff" /><stop offset="1" stopColor="#0a5cc4" /></radialGradient>
        <path id="patch-ring" d="M130,130 m-104,0 a104,104 0 1,1 208,0 a104,104 0 1,1 -208,0" />
        <clipPath id="patch-window"><circle cx="130" cy="130" r="85" /></clipPath>
      </defs>
      <circle cx="130" cy="130" r="127" fill="#0a7cff" />
      <circle cx="130" cy="130" r="121" fill="#06101f" />
      {/* the name fills the rim exactly, so its ends never collide */}
      <g className="patch-rim">
        <text className="patch-text"><textPath href="#patch-ring" startOffset="4" textLength={640} lengthAdjust="spacing">APOLO404 · NASA SPACE APPS CHALLENGE 2026 · UPTC SOGAMOSO ·</textPath></text>
      </g>
      <circle cx="130" cy="130" r="86" fill="url(#patch-bg)" />
      {/* everything inside the window is clipped to it: nothing covers the rim */}
      <g clipPath="url(#patch-window)">
        {[[92, 82], [168, 70], [196, 118], [72, 122], [146, 56], [108, 60]].map(([x, y], k) => <circle key={k} cx={x} cy={y} r={k % 2 ? 1.2 : 1.8} fill="#cfe3ff" />)}
        <circle cx="184" cy="92" r="10" fill="url(#patch-earth)" />
        <path d="M74,104 Q104,68 128,116" fill="none" stroke="#4a9bff" strokeWidth="2" strokeDasharray="4 5" />
        <circle cx="130" cy="198" r="66" fill="url(#patch-moon)" />
        <circle cx="104" cy="178" r="9" fill="#a3abb9" opacity=".7" /><circle cx="160" cy="168" r="6" fill="#a3abb9" opacity=".7" /><circle cx="150" cy="212" r="10" fill="#a3abb9" opacity=".55" />
        <g transform="translate(128,118)">
          <path d="M-9,8 h18 l-3,-10 h-12 z" fill="#f2f4f8" /><rect x="-6" y="-8" width="12" height="6" rx="1.5" fill="#d4a23a" />
          <path d="M-9,8 l-5,7 M9,8 l5,7" stroke="#f2f4f8" strokeWidth="1.6" />
        </g>
        <text x="130" y="190" textAnchor="middle" className="patch-404">404</text>
      </g>
      <circle cx="130" cy="130" r="86" fill="none" stroke="#4a9bff" strokeWidth="2" />
    </svg>
  );
}

const HUES = ['#0a7cff', '#3aa0ff', '#5b6cff', '#1fb6d6', '#7a8cff'];

/** A crew character: helmet with the member's initials on the visor. */
export function CrewAvatar({ initials, index }: { initials: string; index: number }) {
  const hue = HUES[index % HUES.length], id = `crew-${index}`;
  return (
    <svg className="crew-avatar" viewBox="0 0 120 120" aria-hidden>
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="30%" r="75%"><stop offset="0" stopColor={hue} stopOpacity=".55" /><stop offset="1" stopColor="#050b18" /></radialGradient>
        <linearGradient id={`${id}-visor`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0d2a55" /><stop offset=".55" stopColor="#071326" /><stop offset="1" stopColor={hue} /></linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${id}-bg)`} />
      {/* suit */}
      <path d="M22,118 C24,92 40,84 60,84 C80,84 96,92 98,118 Z" fill="#eef2f8" />
      <path d="M52,86 h16 v32 h-16 z" fill={hue} opacity=".9" />
      <circle cx="80" cy="100" r="5" fill={hue} stroke="#fff" strokeWidth="1.5" />
      {/* helmet */}
      <g className="crew-helmet">
        <circle cx="60" cy="52" r="32" fill="#f4f6fa" stroke="#c9d2e0" strokeWidth="2" />
        <rect x="35" y="36" width="50" height="34" rx="16" fill={`url(#${id}-visor)`} />
        <path d="M42,44 q8,-6 18,-5" stroke="#ffffff" strokeOpacity=".55" strokeWidth="3" fill="none" strokeLinecap="round" />
        <text x="60" y="61" textAnchor="middle" className="crew-initials">{initials}</text>
        <rect x="89" y="40" width="5" height="14" rx="2" fill="#c9d2e0" />
        <circle cx="91.5" cy="36" r="3" fill={hue} />
      </g>
    </svg>
  );
}
