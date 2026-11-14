/* Icons from the Phase 1 demo (one set across the product). */
export const ICONS: Record<string, string> = {
  cart: 'M3 4h2l2.2 10.4a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.7L20 8H6.2|c8.5,19,1.4|c17,19,1.4',
  save: 'M5 4h11l3 3v13H5z|M8 4v5h7V4|M8 20v-6h8v6', undo: 'M4 8h10a5 5 0 0 1 0 10H8|M7 4L3 8l4 4',
  pause: 'M8 5v14|M16 5v14', history: 'M3 12a9 9 0 1 0 3-6.7|M3 4v5h5|M12 8v5l3 2', plus: 'M12 5v14|M5 12h14', minus: 'M5 12h14',
  search: 'c11,11,6|M16 16l4 4', box: 'M3 8l9-5 9 5v8l-9 5-9-5z|M3 8l9 5 9-5|M12 13v8',
  truck: 'M2 6h11v9H2z|M13 9h4l3 3v3h-7z|c6,17.5,1.6|c16.5,17.5,1.6', users: 'c9,8,3.2|M3 20a6 6 0 0 1 12 0|c17,9,2.5|M16 14.2A5 5 0 0 1 21 19',
  wallet: 'M3 7h15a3 3 0 0 1 3 3v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M3 7l12-3v3|M17 14h2', chart: 'M4 20V4|M4 20h16|M8 16v-5|M12 16V8|M16 16v-8',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z|M9 12l2 2 4-4', gear: 'c12,12,3|M12 2v3|M12 19v3|M2 12h3|M19 12h3|M5 5l2 2|M17 17l2 2|M19 5l-2 2|M7 17l-2 2',
  print: 'M7 9V3h10v6|M6 17H4v-6h16v6h-2|M7 14h10v7H7z', file: 'M6 3h8l4 4v14H6z|M14 3v4h4', bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4z|M10 21h4',
  tag: 'M3 12V4h8l10 10-8 8z|c7.5,8.5,1.2', cal: 'M4 6h16v14H4z|M4 10h16|M8 3v4|M16 3v4', trash: 'M4 7h16|M9 7V4h6v3|M6 7l1 13h10l1-13',
  check: 'M5 12l5 5 9-10', clip: 'M8 4h8v3H8z|M6 5h2|M16 5h2|M6 5v16h12V5', store: 'M3 9l2-5h14l2 5|M3 9v11h18V9|M9 20v-6h6v6', pct: 'M6 18L18 6|c7.5,8.5,1.5|c16.5,16.5,1.5',
  min: 'M6 18h12', max: 'M5 5h14v14H5z', restore: 'M8 8h11v11H8z|M5 16V5h11', splith: 'M4 5h16v14H4z|M12 5v14', splitv: 'M4 5h16v14H4z|M4 12h16', swap: 'M7 7h13|M16 3l4 4-4 4|M17 17H4|M8 13l-4 4 4 4',
  frames: 'M3 8h13v12H3z|M8 8V4h13v12h-5', calc: 'M6 3h12v18H6z|M9 7h6|M9 11h.01|M12 11h.01|M15 11h.01|M9 15h.01|M12 15h.01|M15 15h.01|M9 18h6', lock: 'M6 11h12v10H6z|M9 11V8a3 3 0 0 1 6 0v3',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z|M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6|M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', logout: 'M10 4H5v16h5|M15 8l4 4-4 4|M19 12H9',
  menu: 'M4 7h16|M4 12h16|M4 17h16', home: 'M3 11l9-7 9 7|M5 10v10h14V10', list: 'M5 4h11l3 3v13H5z|M9 10h6|M9 14h6|M9 18h3', clock: 'c12,12,9|M12 7v5l3 2', alert: 'M12 3L2 20h20z|M12 10v4|M12 17h.01', side: 'M4 4h16v16H4z|M9 4v16', barcode: 'M3 5v14|M6 5v14|M10 5v14|M13 5v14|M17 5v14|M21 5v14', up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', kbd: 'M3 7h18v10H3z|M7 11h.01|M11 11h.01|M15 11h.01|M7 14h10', x: 'M6 6l12 12|M18 6L6 18',
};
export function Icon({ n }: { n: string }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {(ICONS[n] ?? ICONS.file).split('|').map((p, i) => {
        if (/^c[\d.]+,/.test(p)) { const [cx, cy, r] = p.slice(1).split(','); return <circle key={i} cx={cx} cy={cy} r={r} />; }
        return <path key={i} d={p} />;
      })}
    </svg>
  );
}


/** The O Pharmacy mark (owner's choice, 12 Nov 2026): an orange O holding a capsule. Same drawing as the app and tray icons. */
export function Mark({ size = 30, orbit = false, ring = '#9FDDEE' }: { size?: number; orbit?: boolean; ring?: string }) {
  if (!orbit) return (
    <svg width={size} height={size} viewBox="0 0 70 70" aria-hidden="true" style={{ flex: 'none' }}>
      <circle cx="35" cy="35" r="35" fill="#F85A0A" />
      <g transform="rotate(-40 35 35)"><rect x="17" y="27" width="36" height="16" rx="8" fill="#FFFFFF" /><rect x="35" y="27" width="18" height="16" rx="8" fill="#FFD9C4" /><rect x="35" y="27" width="6" height="16" fill="#FFD9C4" /></g>
    </svg>
  );
  /* Sprint 7.11 (owner, 14 Nov 2026): the same O with its orbit (the O stands for Orbit, D40): the ring passes behind the O and in front of it. */
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true" style={{ flex: 'none' }}>
      <g transform="rotate(-24 60 60)"><ellipse cx="60" cy="60" rx="56" ry="24" fill="none" stroke={ring} strokeWidth="5" opacity=".55" /></g>
      <circle cx="60" cy="60" r="31" fill="#F85A0A" />
      <g transform="rotate(-40 60 60)"><rect x="41" y="52" width="38" height="16" rx="8" fill="#FFFFFF" /><rect x="60" y="52" width="19" height="16" rx="8" fill="#FFD9C4" /><rect x="60" y="52" width="6" height="16" fill="#FFD9C4" /></g>
      <g transform="rotate(-24 60 60)"><path d="M4 60 A56 24 0 0 0 116 60" fill="none" stroke={ring} strokeWidth="5" /><circle cx="104" cy="49" r="5.5" fill="#FFFFFF" /></g>
    </svg>
  );
}
export function Logo({ size = 30, orbit = false, light = false }: { size?: number; orbit?: boolean; light?: boolean }) {
  return <span className={`logo${light ? ' light' : ''}`} dir="ltr" role="img" aria-label="O Pharmacy"><Mark size={size} orbit={orbit} ring={light ? '#BFE6F0' : '#5FB3C9'} /><b style={{ fontSize: Math.round(size * (orbit ? 0.6 : 0.72)) }}>Pharmacy</b></span>;
}
