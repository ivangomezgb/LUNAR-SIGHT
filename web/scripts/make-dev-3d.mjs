// SYNTHETIC fixtures only. Never writes public/data.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../public/dev-data/', import.meta.url));
const id = process.argv[2] ?? 'synthetic-shackleton-rim';
if (!/^[\w-]+$/.test(id)) throw new Error('Use a simple site id');
for (const folder of ['terrain', 'pano']) await mkdir(path.join(root, folder), { recursive: true });
const json = (folder, name, value) => writeFile(path.join(root, folder, name), JSON.stringify(value, null, 2));
const specs = {
  near: { file: `${id}.near.bin`, n: 1024, res_m: 10, dtype: 'int16', scale_m: .1, offset_m: 0, source: 'SYNTHETIC development fixture' },
  far: { file: `${id}.far.bin`, n: 256, res_m: 400, dtype: 'int16', scale_m: 1, offset_m: 0, source: 'SYNTHETIC development fixture' },
};
for (const g of Object.values(specs)) {
  const b = Buffer.alloc(g.n * g.n * 2);
  for (let j = 0; j < g.n; j++) for (let i = 0; i < g.n; i++) {
    const x = (i - (g.n - 1) / 2) * g.res_m, y = ((g.n - 1) / 2 - j) * g.res_m;
    const z = 80 * (Math.cos(x / 1800) * Math.cos(y / 2500) - 1) - (x * x + y * y) / (2 * 1737400);
    b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(z / g.scale_m))), (j * g.n + i) * 2);
  }
  await writeFile(path.join(root, 'terrain', g.file), b);
}
await json('terrain', `${id}.json`, { id, frame: 'local ENU tangent plane at site, curvature included', ...specs, site_elev_m: 0, observer_heights_m: [2], synthetic: true });
const width = 2048, height = 400, dist = Buffer.alloc(width * height * 2), normal = Buffer.alloc(width * height * 2);
let mask = null;
try { mask = JSON.parse(await readFile(path.join(root, 'sites', `${id}.json`), 'utf8')).horizon; } catch { /* Standalone fixtures have a flat horizon. */ }
for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) {
  const az = (c + .5) * 360 / width, el = 15 - (r + .5) * 35 / height;
  let h = 0;
  if (mask) { const f = az / mask.az_step_deg, a = Math.floor(f), v = mask.elev_cdeg['2']; h = (v[a % v.length] * (1 - (f - a)) + v[(a + 1) % v.length] * (f - a)) / 100; }
  if (el <= h) { const i = r * width + c; dist.writeUInt16LE(250, i * 2); normal[i * 2] = 128; normal[i * 2 + 1] = 128; }
}
await writeFile(path.join(root, 'pano', `${id}.dist.bin`), dist);
await writeFile(path.join(root, 'pano', `${id}.normal.bin`), normal);
await json('pano', `${id}.json`, { id, synthetic: true, observer_height_m: 2, width, height, az0_deg: 0, el_top_deg: 15, el_bottom_deg: -20, dist: { file: `${id}.dist.bin`, dtype: 'uint16', unit_m: 4, sky: 0 }, normal: { file: `${id}.normal.bin`, dtype: 'uint8x2', encoding: 'octahedral, local ENU' }, max_dist_m: 200000 });
console.log(`SYNTHETIC ${id}: near 1024², far 256², panorama ${width}×${height}. Use VITE_DATA_DIR=dev-data.`);
