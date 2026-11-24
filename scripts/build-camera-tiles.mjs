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
// Sources, merged (cameras within 30 m of each other are treated as one):
//   1. OpenStreetMap (highway=speed_camera)
//   2. Official city/county datasets (scripts/official-sources.mjs)
//   3. Hand-added cameras (data/manual-cameras.json)
//
// Tiles hold raw OSM-style values (camera maxspeed + the maxspeeds of roads within 25 m);
// the app parses them with the same code it uses for live Overpass data.

import fs from 'node:fs/promises';
import path from 'node:path';

import { fetchOfficialCameras } from './official-sources.mjs';

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

// ---- Merge official and hand-added cameras -------------------------------------------

const MERGE_RADIUS_M = 30;
const toRad = (d) => (d * Math.PI) / 180;
function distanceM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

// Grid of ~110 m cells so each lookup only checks nearby cameras.
const cellOf = (lat, lon) => `${Math.floor(lat * 1000)}:${Math.floor(lon * 1000)}`;
const grid = new Map();
const addToGrid = (cam) => {
  const k = cellOf(cam.lat, cam.lon);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(cam);
};
function findNear(c) {
  const [la, lo] = [Math.floor(c.lat * 1000), Math.floor(c.lon * 1000)];
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const cam of grid.get(`${la + i}:${lo + j}`) ?? []) {
        if (distanceM(cam, c) <= MERGE_RADIUS_M) return cam;
      }
    }
  }
}
for (const cam of byId.values()) {
  cam.src = ['osm'];
  addToGrid(cam);
}

async function readManual() {
  try {
    const rows = JSON.parse(await fs.readFile('data/manual-cameras.json', 'utf8')).cameras ?? [];
    return rows.map((r, i) => ({ key: r.key ?? String(i), ...r, source: 'manual' }));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

console.log('Fetching official city datasets…');
const extra = [...(await fetchOfficialCameras()), ...(await readManual())];
const sourceCounts = { osm: byId.size };
const needRoadLimit = [];
for (const c of extra) {
  sourceCounts[c.source] = (sourceCounts[c.source] ?? 0) + 1;
  const existing = findNear(c);
  if (existing) {
    // Same camera: official data wins for the limit, OSM keeps its id and road limits.
    if (c.maxspeed) existing.maxspeed = c.maxspeed;
    if (!existing.name && c.name) existing.name = c.name;
    if (!existing.src.includes(c.source)) existing.src.push(c.source);
    continue;
  }
  const cam = {
    id: `${c.source}:${c.key}`,
    lat: Number(c.lat.toFixed(6)),
    lon: Number(c.lon.toFixed(6)),
    ...(c.maxspeed && { maxspeed: c.maxspeed }),
    ...(c.name && { name: c.name }),
    src: [c.source],
  };
  byId.set(cam.id, cam);
  addToGrid(cam);
  if (!cam.maxspeed) needRoadLimit.push(cam);
}
console.log(`  ${byId.size} cameras after merging`);

// Cameras that came only from official data and have no posted limit: look up the
// limits of roads within 25 m, the same way the OSM query does. A `make` marker before
// each lookup tells us which camera the following roads belong to.
for (let i = 0; i < needRoadLimit.length; i += 200) {
  const batch = needRoadLimit.slice(i, i + 200);
  const query =
    '[out:json][timeout:300];' +
    batch
      .map(
        (c, j) =>
          `make m idx=${j};out;way(around:25,${c.lat},${c.lon})["highway"]["maxspeed"];out tags;`,
      )
      .join('');
  try {
    let current;
    for (const el of await overpass(query)) {
      if (el.type === 'm') current = batch[Number(el.tags.idx)];
      else if (el.type === 'way' && current) {
        (current.roads ??= []).push(el.tags.maxspeed);
        if (!current.name && el.tags.name) current.name = el.tags.name;
      }
    }
  } catch (err) {
    console.warn(`  road limit lookup failed for a batch: ${err.message}`);
  }
}
if (needRoadLimit.length) {
  const found = needRoadLimit.filter((c) => c.roads?.length).length;
  console.log(`  road limits found for ${found}/${needRoadLimit.length} official-only cameras`);
}

// ---- Write tiles -------------------------------------------------------------------------

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
    sources: sourceCounts,
    tiles: [...tiles.keys()].sort(),
    attribution:
      '© OpenStreetMap contributors (ODbL 1.0); City of Chicago, District of Columbia, ' +
      'City of Seattle, City of New Orleans and Montgomery County MD open data',
  }),
);
console.log(`Wrote ${byId.size} cameras in ${tiles.size} tiles to ${outDir}/`);
