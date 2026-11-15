// Test helper: read the published (real) data of a site straight from web/public/data.
import { decodeInt16 } from '../../../lib/terrain';
import type { SiteData, TerrainMeta } from '../../../lib/types';

type Fs = { readFileSync: (path: string, enc?: string) => string & Uint8Array; existsSync: (path: string) => boolean };
const fsName = 'node:fs';
const fs = (await import(/* @vite-ignore */ fsName)) as Fs;

const DATA = 'public/data'; // vitest runs with web/ as the working directory

export function hasRealData(id: string): boolean {
  return fs.existsSync(`${DATA}/terrain/${id}.json`) && fs.existsSync(`${DATA}/sites/${id}.json`);
}

export function loadRealSite(id: string): { site: SiteData; terrain: { meta: TerrainMeta; near: Float32Array; far: Float32Array } } {
  const site = JSON.parse(fs.readFileSync(`${DATA}/sites/${id}.json`, 'utf8')) as SiteData;
  const meta = JSON.parse(fs.readFileSync(`${DATA}/terrain/${id}.json`, 'utf8')) as TerrainMeta;
  const grid = (g: TerrainMeta['near']) => {
    const bytes = fs.readFileSync(`${DATA}/terrain/${g.file}`);
    const copy = new Uint8Array(bytes).buffer;
    return decodeInt16(copy, g.scale_m, g.offset_m);
  };
  return { site, terrain: { meta, near: grid(meta.near), far: grid(meta.far) } };
}
