import Storage from 'expo-sqlite/kv-store';

import {
  AUTO_MAX_RADIUS_M,
  AUTO_MIN_RADIUS_M,
  AUTO_UNKNOWN_SPEED_RADIUS_M,
  AUTO_WARNING_SECONDS,
  FIXED_RADIUS_M,
} from './config';

/**
 * User settings, saved on the device so the background location task respects them too.
 */

export type WarningDistance = 'auto' | 'quarter' | 'half';

const MUTED_KEY = 'alerts-muted-v1';
const DISTANCE_KEY = 'warning-distance-v1';

let muted = false;
let warningDistance: WarningDistance = 'auto';
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

function load() {
  loaded ??= (async () => {
    try {
      const [m, d] = await Promise.all([Storage.getItem(MUTED_KEY), Storage.getItem(DISTANCE_KEY)]);
      muted = m === '1';
      if (d === 'auto' || d === 'quarter' || d === 'half') warningDistance = d;
    } catch {
      // keep defaults
    }
    notify();
  })();
  return loaded;
}

export function subscribeSettings(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

// ---- Mute: no spoken warnings or notification sounds (banners still appear) ------------

export async function isMuted(): Promise<boolean> {
  await load();
  return muted;
}

export const getMutedSnapshot = () => muted;
export const subscribeMuted = subscribeSettings;

export async function setMuted(value: boolean) {
  await load();
  muted = value;
  notify();
  await Storage.setItem(MUTED_KEY, value ? '1' : '0');
}

// ---- Warning distance --------------------------------------------------------------------

export async function getWarningDistance(): Promise<WarningDistance> {
  await load();
  return warningDistance;
}

export const getWarningDistanceSnapshot = () => warningDistance;

export async function setWarningDistance(value: WarningDistance) {
  await load();
  warningDistance = value;
  notify();
  await Storage.setItem(DISTANCE_KEY, value);
}

/**
 * How close a camera must be to trigger a warning. "auto" warns about
 * AUTO_WARNING_SECONDS before reaching the camera at the current speed, within limits.
 */
export function warningRadiusMeters(setting: WarningDistance, speedMps: number | null): number {
  if (setting !== 'auto') return FIXED_RADIUS_M[setting];
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps <= 0) {
    return AUTO_UNKNOWN_SPEED_RADIUS_M;
  }
  return Math.min(AUTO_MAX_RADIUS_M, Math.max(AUTO_MIN_RADIUS_M, speedMps * AUTO_WARNING_SECONDS));
}
