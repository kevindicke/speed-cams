import * as Location from 'expo-location';
import type { LocationObject } from 'expo-location';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { Camera, CameraCache, getCamerasNear, onCamerasUpdated } from './cameras';
import {
  ALERT_RADIUS_M,
  HEADING_FILTER_MAX_DELTA_DEG,
  HEADING_FILTER_MIN_SPEED,
  LOCATION_TASK,
  MAP_MAX_MARKERS,
  MAP_RADIUS_M,
  RESET_RADIUS_M,
  SPEEDING_REPEAT_MS,
  SPEEDING_TOLERANCE_MPS,
} from './config';
import { bearingDegrees, distanceMeters, formatMiles, headingDelta, LatLng } from './geo';
import { sendCameraAlert, sendSpeedingAlert } from './notifications';
import { getProSnapshot, isPro } from './pro';
import { SpeedLimit, speedInUnit } from './speedLimit';

export type NearbyCamera = Camera & { distance: number; ahead: boolean };

export type TrackerState = {
  position: LatLng | null;
  speedMps: number | null;
  nearby: NearbyCamera[];
  /** Cameras to plot on the map: everything within MAP_RADIUS_M, nearest first. */
  mapCameras: NearbyCamera[];
  cameraCount: number;
  dataFetchedAt: number | null;
  activeAlert: NearbyCamera | null;
  /** Over the limit while approaching a camera with a known limit. */
  speeding: boolean;
  error: string | null;
};

const ALERTED_KEY = 'alerted-cameras-v1';

let state: TrackerState = {
  position: null,
  speedMps: null,
  nearby: [],
  mapCameras: [],
  cameraCount: 0,
  dataFetchedAt: null,
  activeAlert: null,
  speeding: false,
  error: null,
};

const listeners = new Set<(s: TrackerState) => void>();

export function getState() {
  return state;
}

export function subscribe(fn: (s: TrackerState) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setState(patch: Partial<TrackerState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

let fixSeq = 0;

/** Camera IDs we've already warned about and haven't driven away from yet. */
let alerted: Set<string> | null = null;

async function loadAlerted(): Promise<Set<string>> {
  if (alerted) return alerted;
  try {
    const raw = await Storage.getItem(ALERTED_KEY);
    alerted = new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    alerted = new Set();
  }
  return alerted;
}

async function saveAlerted(set: Set<string>) {
  await Storage.setItem(ALERTED_KEY, JSON.stringify([...set]));
}

const spokenUnit = (label: string) =>
  label.replace('mph', 'miles per hour').replace('km/h', 'kilometers per hour');

function speedText(mps: number, limit: SpeedLimit) {
  return `${Math.round(speedInUnit(mps, limit.unit))} ${limit.unit}`;
}

function isSpeeding(speed: number | null, cam: NearbyCamera | undefined): cam is NearbyCamera & { limit: SpeedLimit } {
  return speed != null && cam?.limit != null && speed > cam.limit.mps + SPEEDING_TOLERANCE_MPS;
}

function describe(cam: NearbyCamera, speed: number | null) {
  const limit = cam.limit ? ` Limit ${cam.limit.label}.` : '';
  const where = cam.name ? ` on ${cam.name}` : '';
  const distance = formatMiles(cam.distance);
  let spoken = `Speed camera ahead in ${distance.replace('mi', 'miles').replace('ft', 'feet')}.${spokenUnit(limit)}`;
  let title = '📸 Speed camera ahead';
  if (isSpeeding(speed, cam)) {
    title = '🚨 Slow down — speed camera ahead';
    spoken += ` Slow down! You're doing ${spokenUnit(speedText(speed!, cam.limit))}.`;
  }
  return { title, body: `Camera${where} in ${distance}.${limit}`, spoken };
}

/** When we last spoke a speeding warning, and for which camera. */
let lastSpeedingWarn: { cameraId: string; at: number } | null = null;

let lastHeading: number | null = null;
let alertsOn = false;

function computeNearby(position: LatLng, cameras: Camera[], heading: number | null): NearbyCamera[] {
  return cameras
    .map((cam) => {
      const distance = distanceMeters(position, cam);
      const ahead =
        heading != null
          ? headingDelta(heading, bearingDegrees(position, cam)) <= HEADING_FILTER_MAX_DELTA_DEG
          : true;
      return { ...cam, distance, ahead };
    })
    .sort((a, b) => a.distance - b.distance);
}

function showCameras(position: LatLng, data: CameraCache, heading: number | null, alertsOn: boolean) {
  const nearby = computeNearby(position, data.cameras, heading);
  // Only cameras ahead of us count (all of them when heading is unknown, e.g. stopped).
  const target = alertsOn ? approachingCamera(nearby) : undefined;
  setState({
    // Speeding warnings are a Pro feature.
    speeding: getProSnapshot() && isSpeeding(state.speedMps, target),
    nearby: nearby.slice(0, 20),
    mapCameras: nearby.filter((c) => c.distance <= MAP_RADIUS_M).slice(0, MAP_MAX_MARKERS),
    cameraCount: data.cameras.length,
    dataFetchedAt: data.fetchedAt,
    activeAlert: target ?? null,
    error: null,
  });
  return nearby;
}

/** The nearest camera ahead of us within the warning radius, if any. */
function approachingCamera(nearby: NearbyCamera[]) {
  return nearby.find((c) => c.distance <= ALERT_RADIUS_M && c.ahead);
}

// When a background download finishes, refresh the list for wherever we last were.
onCamerasUpdated((data) => {
  if (state.position) showCameras(state.position, data, lastHeading, alertsOn);
});

/**
 * Feed a GPS fix in. Called by the background task (and therefore also in the foreground).
 * With `alerts: false` it only loads and displays nearby cameras.
 */
export async function processLocation(loc: LocationObject, { alerts = true } = {}) {
  await isPro(); // load saved Pro status before anything reads it
  const position = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
  const speed = loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed : null;
  const heading = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
  const useHeading = heading != null && speed != null && speed >= HEADING_FILTER_MIN_SPEED;
  lastHeading = useHeading ? heading : null;
  alertsOn = alerts;

  // Show the fix immediately, even before camera data is available.
  const seq = ++fixSeq;
  setState({ position, speedMps: alerts ? speed : null });

  let data: CameraCache;
  try {
    data = await getCamerasNear(position);
    // A newer fix arrived while we waited on the network; let that one do the work.
    if (seq !== fixSeq) return;
  } catch (err) {
    setState({ error: `Couldn't load camera data: ${String(err)}` });
    return;
  }

  const nearby = showCameras(position, data, lastHeading, alerts);
  if (!alerts) return;

  // Free: warnings only while the app is on screen. Pro: also in the background.
  const pro = await isPro();
  if (!pro && AppState.currentState !== 'active') return;

  const seen = await loadAlerted();
  let changed = false;

  // Forget cameras we've moved well away from, so they can alert again next time.
  for (const id of [...seen]) {
    const cam = nearby.find((c) => c.id === id);
    if (!cam || cam.distance > RESET_RADIUS_M) {
      seen.delete(id);
      changed = true;
    }
  }

  const toAlert = nearby.find(
    (c) => c.distance <= ALERT_RADIUS_M && c.ahead && !seen.has(c.id),
  );
  if (toAlert) {
    seen.add(toAlert.id);
    changed = true;
    const { title, body, spoken } = describe(toAlert, pro ? speed : null);
    if (isSpeeding(speed, toAlert)) lastSpeedingWarn = { cameraId: toAlert.id, at: Date.now() };
    await sendCameraAlert(title, body, spoken);
  }
  if (changed) await saveAlerted(seen);

  // Speeding toward a camera: warn out loud, and keep repeating while still too fast.
  const target = approachingCamera(nearby);
  if (pro && target && isSpeeding(speed, target)) {
    const now = Date.now();
    const sameCamera = lastSpeedingWarn?.cameraId === target.id;
    if (!sameCamera || now - lastSpeedingWarn!.at >= SPEEDING_REPEAT_MS) {
      lastSpeedingWarn = { cameraId: target.id, at: now };
      const yours = speedText(speed!, target.limit);
      await sendSpeedingAlert(
        '🚨 Slow down — speed camera ahead',
        `You're doing ${yours} in a ${target.limit.label} zone. Camera in ${formatMiles(target.distance)}.`,
        `Slow down! Speed camera ahead. Limit ${spokenUnit(target.limit.label)}.`,
        { withNotification: !sameCamera },
      );
    }
  }
}

/**
 * On app launch: find where the user is, download the cameras around them and save
 * them on the device, so the list is ready (and works offline) before alerts start.
 */
export async function preloadNearbyCameras() {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      setState({ error: 'Allow location access to find speed cameras near you.' });
      return;
    }
    // Last known position is instant; use it first, then refine with a fresh fix.
    const last = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60_000 });
    if (last && !state.position) await processLocation(last, { alerts: false });
    const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    // Don't overwrite live tracking data if alerts were started meanwhile.
    if (!(await isTrackingStarted())) await processLocation(current, { alerts: false });
  } catch (err) {
    setState({ error: `Couldn't get your location: ${String(err)}` });
  }
}

function isTrackingStarted() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false);
}

export async function refreshCameraData() {
  if (!state.position) return;
  try {
    // A successful download updates the list through onCamerasUpdated.
    await getCamerasNear(state.position, true);
  } catch (err) {
    setState({ error: `Couldn't load camera data: ${String(err)}` });
  }
}
