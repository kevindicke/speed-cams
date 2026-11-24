import Storage from 'expo-sqlite/kv-store';

import { CACHE_MAX_AGE_MS, CAMERA_TILES_URL, FETCH_RADIUS_M, REFETCH_DISTANCE_M } from './config';
import { boundingBox, distanceMeters, LatLng } from './geo';
import { parseMaxspeed, pickRoadLimit, SpeedLimit } from './speedLimit';

export type Camera = LatLng & {
  id: string;
  /** Posted limit from OSM `maxspeed` tag, e.g. "30 mph", if known. */
  maxspeed?: string;
  /** Speed limit used for speeding warnings: the camera's own, else the road it's on. */
  limit?: SpeedLimit;
  limitSource?: 'camera' | 'road';
  /** Direction the camera enforces, degrees, from OSM `direction` tag, if known. */
  direction?: number;
  name?: string;
};

export type CameraCache = {
  center: LatLng;
  fetchedAt: number;
  cameras: Camera[];
};

// v2: cameras carry a parsed speed limit (from the camera or its road).
const CACHE_KEY = 'camera-cache-v2';

/**
 * Public Overpass API instances (OpenStreetMap). Tried in order.
 * For a production app with many users, host your own Overpass instance or
 * pre-build a camera dataset and serve it from your own backend.
 */
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

let memoryCache: CameraCache | null = null;
let inFlight: Promise<CameraCache> | null = null;
let failures = 0;
const updateListeners = new Set<(cache: CameraCache) => void>();

/** Notified whenever fresh camera data has been downloaded and saved. */
export function onCamerasUpdated(fn: (cache: CameraCache) => void) {
  updateListeners.add(fn);
  return () => {
    updateListeners.delete(fn);
  };
}
let lastFailureAt = 0;

/** The saved camera data, without downloading anything. */
export function getSavedCameras(): Promise<CameraCache | null> {
  return readCache();
}

async function readCache(): Promise<CameraCache | null> {
  if (memoryCache) return memoryCache;
  try {
    const raw = await Storage.getItem(CACHE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as CameraCache) : null;
  } catch {
    memoryCache = null;
  }
  return memoryCache;
}

function parseDirection(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
  const cardinal: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return cardinal[value.toUpperCase()];
}

type OverpassElement = {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function parseCameras(elements: OverpassElement[]): Camera[] {
  const cameras: Camera[] = [];
  let roadLimits: (string | undefined)[] = [];
  const finish = () => {
    const cam = cameras[cameras.length - 1];
    if (cam && !cam.limit) {
      const road = pickRoadLimit(roadLimits);
      if (road) {
        cam.limit = road;
        cam.limitSource = 'road';
      }
    }
    roadLimits = [];
  };
  for (const el of elements) {
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      finish();
      const own = parseMaxspeed(el.tags?.maxspeed);
      cameras.push({
        id: `osm-${el.id}`,
        latitude: el.lat,
        longitude: el.lon,
        maxspeed: el.tags?.maxspeed,
        limit: own,
        limitSource: own ? 'camera' : undefined,
        direction: parseDirection(el.tags?.direction),
        name: el.tags?.name,
      });
    } else if (el.type === 'way') {
      roadLimits.push(el.tags?.maxspeed);
      // Name the camera after its road when it has no name of its own.
      const cam = cameras[cameras.length - 1];
      if (cam && !cam.name && el.tags?.name) cam.name = el.tags.name;
    }
  }
  finish();
  return cameras;
}

/** One camera as stored in a tile file (raw OSM values; see build-camera-tiles.mjs). */
type TileCamera = {
  /** OSM node id (number), or "<source>:<key>" for cameras from official city data. */
  id: number | string;
  lat: number;
  lon: number;
  maxspeed?: string;
  direction?: string;
  name?: string;
  /** maxspeed values of roads within 25 m. */
  roads?: string[];
};

function fromTile(t: TileCamera): Camera {
  const own = parseMaxspeed(t.maxspeed);
  const road = own ? undefined : pickRoadLimit(t.roads ?? []);
  return {
    id: typeof t.id === 'number' ? `osm-${t.id}` : t.id,
    latitude: t.lat,
    longitude: t.lon,
    maxspeed: t.maxspeed,
    limit: own ?? road,
    limitSource: own ? 'camera' : road ? 'road' : undefined,
    direction: parseDirection(t.direction),
    name: t.name,
  };
}

// ---- Tiles from our own host (GitHub Pages) ---------------------------------------------

/** Downloaded tiles kept in memory, so panning around the map doesn't refetch them. */
const TILE_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
const tileMemory = new Map<string, { at: number; cameras: Camera[] }>();
const tileRequests = new Map<string, Promise<Camera[]>>();

/** Keys ("lat_lon" of the SW corner) of the 1°×1° tiles overlapping a box. */
function tileKeys([s, w, n, e]: [number, number, number, number]): string[] {
  const keys: string[] = [];
  for (let lat = Math.floor(s); lat <= Math.floor(n); lat++) {
    for (let lon = Math.floor(w); lon <= Math.floor(e); lon++) keys.push(`${lat}_${lon}`);
  }
  return keys;
}

function fetchTile(key: string): Promise<Camera[]> {
  const cached = tileMemory.get(key);
  if (cached && Date.now() - cached.at < TILE_MEMORY_TTL_MS) return Promise.resolve(cached.cameras);
  const pending = tileRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${CAMERA_TILES_URL.replace(/\/+$/, "")}/tiles/${key}.json`, {
        signal: controller.signal,
      });
      let cameras: Camera[] = [];
      if (res.status !== 404) {
        // 404 just means no cameras in this square.
        if (!res.ok) throw new Error(`Tiles ${res.status}`);
        cameras = sanitize(((await res.json()) as TileCamera[]).map(fromTile));
      }
      tileMemory.set(key, { at: Date.now(), cameras });
      return cameras;
    } finally {
      clearTimeout(timer);
      tileRequests.delete(key);
    }
  })();
  tileRequests.set(key, request);
  return request;
}

/** Downloads the tiles overlapping the area around `center`. */
async function fetchFromTiles(center: LatLng): Promise<Camera[]> {
  const tiles = await Promise.all(tileKeys(boundingBox(center, FETCH_RADIUS_M)).map(fetchTile));
  return tiles.flat();
}

export type MapBounds = { south: number; west: number; north: number; east: number };

/** Above this many tiles (~4°×4° of map) the view is too zoomed out to load cameras. */
export const MAX_VIEW_TILES = 16;

export type ViewCameras =
  | { status: 'ok'; cameras: Camera[] }
  | { status: 'zoom-in' }
  | { status: 'unavailable' };

/**
 * Cameras inside the visible map area, for browsing the map anywhere (not used for
 * warnings, which only use cameras around the user's position).
 */
export async function getCamerasInView(b: MapBounds): Promise<ViewCameras> {
  if (!CAMERA_TILES_URL) return { status: 'unavailable' };
  const keys = tileKeys([b.south, b.west, b.north, b.east]);
  if (keys.length > MAX_VIEW_TILES) return { status: 'zoom-in' };
  const tiles = await Promise.all(keys.map(fetchTile));
  const cameras = tiles
    .flat()
    .filter(
      (c) =>
        c.latitude >= b.south &&
        c.latitude <= b.north &&
        c.longitude >= b.west &&
        c.longitude <= b.east,
    );
  return { status: 'ok', cameras };
}

const MAX_NAME_LENGTH = 80;

/**
 * Downloaded data comes from crowd-sourced and third-party sources: drop cameras with
 * impossible coordinates and trim oversized text before it reaches the UI.
 */
function sanitize(cameras: Camera[]): Camera[] {
  const out: Camera[] = [];
  for (const cam of cameras) {
    const { latitude: lat, longitude: lon } = cam;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const name =
      typeof cam.name === 'string' && cam.name.trim()
        ? cam.name.trim().slice(0, MAX_NAME_LENGTH)
        : undefined;
    const maxspeed =
      typeof cam.maxspeed === 'string' ? cam.maxspeed.slice(0, 20) : undefined;
    out.push({ ...cam, id: String(cam.id).slice(0, 100), name, maxspeed });
  }
  return out;
}

/** Our own tiles first (fast); the public Overpass API if they're not set up or unreachable. */
async function fetchCameras(center: LatLng): Promise<Camera[]> {
  if (CAMERA_TILES_URL) {
    try {
      return sanitize(await fetchFromTiles(center));
    } catch (err) {
      console.warn('[cameras] tiles failed, falling back to Overpass', String(err));
    }
  }
  return sanitize(await fetchFromOverpass(center));
}

/** Rounding the query center to this grid (~7 mi) adds at most this much offset. */
const OVERPASS_GRID_DEG = 0.1;
const OVERPASS_GRID_SLACK_M = 8_000;

async function fetchFromOverpass(center: LatLng): Promise<Camera[]> {
  // Privacy: the public Overpass server must not learn the user's exact position, so
  // query around a point snapped to a ~7-mile grid, widened to still cover the same area.
  const snap = (v: number) => Math.round(v / OVERPASS_GRID_DEG) * OVERPASS_GRID_DEG;
  const coarse = { latitude: snap(center.latitude), longitude: snap(center.longitude) };
  const [s, w, n, e] = boundingBox(coarse, FETCH_RADIUS_M + OVERPASS_GRID_SLACK_M).map((v) =>
    v.toFixed(3),
  );
  // Fixed speed cameras are tagged highway=speed_camera in OpenStreetMap. For each one,
  // also return the speed limits of roads within 25 m: many cameras have no limit of
  // their own. The output is each camera followed by its roads' tags, in order.
  const query =
    `[out:json][timeout:60];node["highway"="speed_camera"](${s},${w},${n},${e})->.cams;` +
    `foreach.cams->.c(.c out body;way(around.c:25)["highway"]["maxspeed"];out tags;);`;

  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    // Public Overpass servers can take 30–40 s when busy.
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Overpass returns 406 for requests without an identifying User-Agent.
          'User-Agent': 'SpeedCams/1.0 (React Native)',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements: OverpassElement[] };
      return parseCameras(json.elements);
    } catch (err) {
      console.warn('[cameras] fetch failed', endpoint, String(err));
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new Error('All Overpass endpoints failed');
}

/**
 * Returns cameras around `position`, downloading fresh data only when the user has
 * left the cached area or the cache is stale. Falls back to stale cache when offline.
 */
export async function getCamerasNear(position: LatLng, force = false): Promise<CameraCache> {
  const cache = await readCache();
  const fresh =
    cache &&
    Date.now() - cache.fetchedAt < CACHE_MAX_AGE_MS &&
    distanceMeters(cache.center, position) < REFETCH_DISTANCE_M;
  if (fresh && !force) return cache;

  if (!inFlight) {
    // Exponential backoff after failures (30 s, 1 min, 2 min … capped at 10 min),
    // as the public Overpass servers request when they're overloaded.
    const backoffMs = Math.min(30_000 * 2 ** Math.max(0, failures - 1), 10 * 60_000);
    if (failures > 0 && !force && Date.now() - lastFailureAt < backoffMs) {
      if (cache) return cache;
      throw new Error(`camera servers busy, retrying in ${Math.ceil((backoffMs - (Date.now() - lastFailureAt)) / 1000)}s`);
    }
    inFlight = (async () => {
      try {
        const cameras = await fetchCameras(position);
        const next: CameraCache = { center: position, fetchedAt: Date.now(), cameras };
        memoryCache = next;
        failures = 0;
        await Storage.setItem(CACHE_KEY, JSON.stringify(next));
        updateListeners.forEach((fn) => fn(next));
        return next;
      } catch (err) {
        failures += 1;
        lastFailureAt = Date.now();
        throw err;
      }
    })().finally(() => {
      inFlight = null;
    });
  }

  if (cache && !force) {
    // Keep alerting from what we have; the refresh finishes in the background.
    inFlight.catch(() => {});
    return cache;
  }

  try {
    return await inFlight;
  } catch (err) {
    if (cache) return cache; // offline or rate-limited: keep using what we have
    throw err;
  }
}
