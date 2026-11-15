import { computeFreePoint, loadFreeAssets } from './freepoint';
import type { FreeAssets } from './freepoint';

let assets: Promise<FreeAssets> | undefined;
self.onmessage = async (event: MessageEvent<{ lat: number; lon: number; base: string }>) => {
  try {
    assets ??= loadFreeAssets(event.data.base).catch(error => { assets = undefined; throw error; });
    const data = await assets;
    const result = computeFreePoint(data, event.data.lat, event.data.lon,
      progress => self.postMessage({ kind: 'progress', progress }));
    self.postMessage({ kind: 'result', result });
  } catch (error) {
    self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : 'Free-coordinate calculation failed' });
  }
};
