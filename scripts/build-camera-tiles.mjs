// Builds static camera tiles from OpenStreetMap for the app to download.
//
//   node scripts/build-camera-tiles.mjs [outDir]
//
// Env:
//   REGIONS  Comma-separated ISO codes to cover. Countries ("US", "GB") or
//            subdivisions ("US-DC", "US-IL"). Default "US".
//
// Output (default outDir = public):
//   public/tiles/<lat>_<lon>.json   cameras in the 1°×1° square whose SW corner is (lat, lon)
//   public/index.json               { generatedAt, regions, count, tiles: [...] }
//
// Tiles hold raw OSM values (camera maxspeed + the maxspeeds of roads within 25 m);
// the app parses them with the same code it uses for live Overpass data.

import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = process.argv[2] ?? 'public';
const regions = (process.env.REGIONS ?? 'US').split(',').map((r) => r.trim()).filter(Boolean);
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'SpeedCams-tile-builder/1.0 (GitHub Actions)';

function queryFor(region) {
  const key = region.includes('-') ? 'ISO3166-2' : 'ISO3166-1';
  return (
    `[out:json][timeout:900];area["${key}"="${region}"]->.a;` +
    `node["highway"="speed_camera"](area.a)->.cams;` +
    `foreach.cams->.c(.c out body;way(around.c:25)["highway"]["maxspeed"];out tags;);`
  );
}

async function overpass(query) {
  // The public server asks clients to back off when busy: 1, 2, 4, 8 minutes.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      const wait = 60_000 * 2 ** (attempt - 1);
      console.log(`  retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(20 * 60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.remark?.includes('runtime error')) throw new Error(json.remark);
      return json.elements;
    } catch (err) {
      console.warn(`  Overpass failed: ${err.message}`);
    }
  }
  throw new Error('Overpass failed after 5 attempts');
}

/** Elements come as: camera node, then the tags of each nearby road with a limit. */
function toCameras(elements) {
  const cameras = [];
  for (const el of elements) {
    if (el.type === 'node') {
      const t = el.tags ?? {};
      cameras.push({
        id: el.id,
        lat: Number(el.lat.toFixed(6)),
        lon: Number(el.lon.toFixed(6)),
        ...(t.maxspeed && { maxspeed: t.maxspeed }),
        ...(t.direction && { direction: t.direction }),
        ...(t.name && { name: t.name }),
        roads: [],
      });
    } else if (el.type === 'way' && cameras.length) {
      const cam = cameras[cameras.length - 1];
      cam.roads.push(el.tags.maxspeed);
      if (!cam.name && el.tags.name) cam.name = el.tags.name;
    }
  }
  for (const cam of cameras) if (!cam.roads.length) delete cam.roads;
  return cameras;
}

const byId = new Map();
for (const region of regions) {
  console.log(`Fetching ${region}…`);
  const cams = toCameras(await overpass(queryFor(region)));
  console.log(`  ${cams.length} cameras`);
  if (cams.length === 0) throw new Error(`No cameras for ${region}; refusing to publish empty data`);
  for (const cam of cams) byId.set(cam.id, cam);
}

const tiles = new Map();
for (const cam of byId.values()) {
  const key = `${Math.floor(cam.lat)}_${Math.floor(cam.lon)}`;
  if (!tiles.has(key)) tiles.set(key, []);
  tiles.get(key).push(cam);
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, 'tiles'), { recursive: true });
for (const [key, cams] of tiles) {
  await fs.writeFile(path.join(outDir, 'tiles', `${key}.json`), JSON.stringify(cams));
}
await fs.writeFile(
  path.join(outDir, 'index.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    regions,
    count: byId.size,
    tiles: [...tiles.keys()].sort(),
    attribution: '© OpenStreetMap contributors, ODbL 1.0',
  }),
);
console.log(`Wrote ${byId.size} cameras in ${tiles.size} tiles to ${outDir}/`);
