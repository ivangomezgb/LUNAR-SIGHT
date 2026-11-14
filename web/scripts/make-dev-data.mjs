// Generates SYNTHETIC development fixtures into web/public/dev-data/ (gitignored).
// Pass --no-basemap to test the drawn polar-grid fallback.
// These are NOT real data: geometry is a crude analytic approximation and horizons are
// random smooth noise. Use only for UI development:  VITE_DATA_DIR=dev-data npm run dev
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'dev-data');
mkdirSync(join(out, 'sites'), { recursive: true });

const T0 = Date.parse('2026-11-01T00:00:00Z');
const N = 19008;
const D2R = Math.PI / 180;
const SYN = 29.530589 * 24; // h
const DRAC = 346.62 * 24; // h  (eclipse year ~ sub-solar latitude cycle)
const ANOM = 27.5545 * 24; // longitude libration
const DRACM = 27.2122 * 24; // latitude libration

// Mulberry32 PRNG for reproducibility.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function altAz(latDeg, lonDeg, decDeg, subLonDeg) {
  const phi = latDeg * D2R;
  const d = decDeg * D2R;
  const H = (lonDeg - subLonDeg) * D2R;
  const sinEl = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  const el = Math.asin(sinEl);
  const y = -Math.cos(d) * Math.sin(H);
  const x = Math.sin(d) * Math.cos(phi) - Math.cos(d) * Math.cos(H) * Math.sin(phi);
  let az = Math.atan2(y, x) / D2R;
  az = ((az % 360) + 360) % 360;
  return [az, el / D2R];
}

const SITES = [
  ['mons-mouton', 'Mons Mouton (synthetic)', -84.29, 1.37, 'artemis'],
  ['shackleton-rim', 'Shackleton Rim (synthetic)', -89.67, 129.2, 'artemis'],
  ['connecting-ridge', 'Connecting Ridge (synthetic)', -89.45, -137.3, 'science'],
  ['de-gerlache-rim', 'de Gerlache Rim (synthetic)', -88.67, -67.9, 'artemis'],
  ['malapert-massif', 'Malapert Massif (synthetic)', -86.0, 2.8, 'artemis'],
  ['haworth', 'Haworth (synthetic)', -87.45, -4.0, 'science'],
  ['nobile-rim-1', 'Nobile Rim 1 (synthetic)', -85.43, 36.6, 'artemis'],
  ['amundsen-rim', 'Amundsen Rim (synthetic)', -84.22, 70.5, 'artemis'],
  ['im2-athena', 'IM-2 Athena landing area (synthetic)', -84.79, 29.2, 'clps'],
  ['peak-near-shackleton', 'Peak near Shackleton (synthetic)', -88.79, 123.6, 'artemis'],
  ['leibnitz-beta', 'Leibnitz Beta Plateau (synthetic)', -85.42, 31.7, 'artemis'],
  ['far-side-ridge', 'Far-side Ridge (synthetic)', -86.8, 176.0, 'science'],
];

// basemap-like pixel positions for a 1024 px polar map covering lat <= -80
const W = 1024;
function mapPx(lat, lon) {
  const r = ((90 + lat) / 10) * (W / 2);
  const th = lon * D2R;
  return [Math.round(W / 2 + r * Math.sin(th)), Math.round(W / 2 - r * Math.cos(th))];
}

const index = [];
SITES.forEach(([slug, name, lat, lon, group], k) => {
  const id = `synthetic-${slug}`;
  const rand = rng(1000 + k * 7919);
  // horizon: smooth noise from a few harmonics, plus a big ridge
  const harm = Array.from({ length: 9 }, (_, i) => ({
    a: (rand() * 1.4) / (1 + i * 0.6),
    f: i + 1,
    p: rand() * Math.PI * 2,
  }));
  const ridgeAz = rand() * 360;
  const ridgeH = 1 + rand() * 3.5;
  const base = rand() * 1.2 - 0.6;
  const mask = [];
  for (let i = 0; i < 720; i++) {
    const az = i * 0.5;
    let v = base;
    for (const h of harm) v += h.a * Math.sin(h.f * az * D2R + h.p);
    const dd = Math.abs(((az - ridgeAz + 540) % 360) - 180);
    v += ridgeH * Math.exp(-(dd * dd) / (2 * 18 * 18));
    v += (rand() - 0.5) * 0.12;
    mask.push(Math.round(Math.max(-4.5, v) * 100));
  }
  const mask10 = mask.map((c) => Math.round(c * 0.85 - 20));

  const sunAz = new Array(N), sunEl = new Array(N), earthAz = new Array(N), earthEl = new Array(N);
  for (let i = 0; i < N; i++) {
    const h = i;
    const dec = 1.54 * Math.sin((2 * Math.PI * h) / DRAC + 0.7);
    const subLon = 180 - (360 * ((h / SYN) % 1)) + 37;
    const [sa, se] = altAz(lat, lon, dec, subLon);
    sunAz[i] = Math.round(sa * 100);
    sunEl[i] = Math.round(se * 100);
    const eLat = 6.68 * Math.sin((2 * Math.PI * h) / DRACM + 1.1);
    const eLon = 7.9 * Math.sin((2 * Math.PI * h) / ANOM + 0.3);
    const [ea, ee] = altAz(lat, lon, eLat, eLon);
    earthAz[i] = Math.round(ea * 100);
    earthEl[i] = Math.round(ee * 100);
  }

  const elev = Math.round(-1500 + rand() * 7000);
  const slope = +(2 + rand() * 12).toFixed(1);
  const data = {
    id,
    generated_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    frame: 'MOON_ME',
    horizon: { az_step_deg: 0.5, heights_m: [2, 10], elev_cdeg: { '2': mask, '10': mask10 }, max_dist_m: 150000 },
    ephem: {
      t0_utc: '2026-11-01T00:00:00Z',
      step_h: 1,
      n: N,
      sun: { az_cdeg: sunAz, el_cdeg: sunEl },
      earth: { az_cdeg: earthAz, el_cdeg: earthEl },
    },
    uncertainty: k % 3 === 0 ? { illum_pct_p5: 60, illum_pct_p50: 68, illum_pct_p95: 74 } : null,
  };
  writeFileSync(join(out, 'sites', `${id}.json`), JSON.stringify(data));
  index.push({
    id,
    name,
    lat_deg: lat,
    lon_deg: lon,
    elev_m: elev,
    group,
    tags: ['synthetic'],
    source_url: 'https://example.invalid/synthetic',
    source_note: 'SYNTHETIC development fixture - not real data',
    dem_res_m: 5,
    dem_source: 'SYNTHETIC (no DEM)',
    has_clones: false,
    slope_deg_50m: slope,
    map_px: mapPx(lat, lon),
  });
});
writeFileSync(join(out, 'sites.json'), JSON.stringify(index, null, 1));

// synthetic validation
const vr = rng(42);
const rows = [];
for (const s of index.slice(0, 4)) {
  for (const body of ['sun', 'earth']) {
    for (let j = 0; j < 3; j++) {
      const azo = vr() * 360, elo = vr() * 8 - 2;
      const daz = (vr() - 0.5) * 0.02, del = (vr() - 0.5) * 0.02;
      rows.push({
        site: s.id,
        t_utc: new Date(T0 + Math.floor(vr() * 10000) * 3600e3).toISOString().replace(/\.\d+Z$/, 'Z'),
        body, az_ours: +azo.toFixed(4), el_ours: +elo.toFixed(4),
        az_horizons: +(azo - daz).toFixed(4), el_horizons: +(elo - del).toFixed(4),
        d_az: +daz.toFixed(4), d_el: +del.toFixed(4),
      });
    }
  }
}
const im2Mask = Array.from({ length: 720 }, (_, i) => Math.round(80 + 120 * Math.sin((i * 0.5 + 40) * D2R * 2) + 60 * Math.sin(i * 0.5 * D2R * 5)));
const validation = {
  generated_utc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  method: 'SYNTHETIC: compared against fake reference values (dev fixture only)',
  rows,
  summary: {
    n: rows.length,
    max_abs_d_az_deg: Math.max(...rows.map((r) => Math.abs(r.d_az))),
    max_abs_d_el_deg: Math.max(...rows.map((r) => Math.abs(r.d_el))),
    threshold_deg: 0.05,
    pass: true,
  },
  im2: {
    site: 'synthetic-im2-athena', t_utc: '2025-03-06T17:31:00Z', lat_deg: -84.79, lon_deg: 29.2,
    sun_az_deg: 62.4, sun_el_deg: 1.1, horizon_el_at_sun_az_deg: 1.35, sun_fraction: 0.21, earth_el_deg: 4.6,
    horizon_az_step_deg: 0.5, horizon_elev_cdeg: im2Mask,
    note: 'SYNTHETIC case study for UI development. The real IM-2 lander tipped over in a crater with low Sun.',
  },
};
writeFileSync(join(out, 'validation.json'), JSON.stringify(validation, null, 1));
// synthetic grayscale basemap (cratered noise) + basemap.json, same pixel frame as map_px
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const br = rng(7);
const craters = Array.from({ length: 260 }, () => ({ x: br() * W, y: br() * W, r: 4 + Math.pow(br(), 3) * 90 }));
const raw = Buffer.alloc((W + 1) * W);
for (let y = 0; y < W; y++) {
  raw[y * (W + 1)] = 0;
  for (let x = 0; x < W; x++) {
    let v = 0.42 + 0.05 * Math.sin(x * 0.02) * Math.cos(y * 0.017);
    for (const c of craters) {
      const dx = x - c.x, dy = y - c.y, d = Math.sqrt(dx * dx + dy * dy) / c.r;
      if (d < 1.25) v += d < 1 ? (dx * 0.7 + dy * 0.7) / c.r * 0.35 - 0.08 : (1.25 - d) * 0.3;
    }
    const rr = Math.hypot(x - W / 2, y - W / 2) / (W / 2);
    if (rr > 1) v *= 0.25;
    raw[y * (W + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(v * 200)));
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
if (!process.argv.includes('--no-basemap')) {
  writeFileSync(join(out, 'basemap.png'), png);
  const m = 303000 / (W / 2);
  writeFileSync(join(out, 'basemap.json'), JSON.stringify({
    image: 'basemap.png', width_px: W, height_px: W,
    crs: '+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs (SYNTHETIC)',
    affine: [m, 0, -W / 2 * m, 0, -m, W / 2 * m], extent_lat_deg: -80,
  }, null, 1));
}
console.log(`Wrote ${index.length} synthetic sites to ${out}`);
