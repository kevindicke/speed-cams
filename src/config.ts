import { METERS_PER_MILE } from './geo';

/** Warn when a camera is within this distance (half a mile). */
export const ALERT_RADIUS_M = 0.5 * METERS_PER_MILE;

/** After alerting, don't alert for the same camera again until we're this far away. */
export const RESET_RADIUS_M = 0.75 * METERS_PER_MILE;

/** Area of camera data to download around the user. */
export const FETCH_RADIUS_M = 25_000;

/** Re-download when the user has moved this far from the last download center. */
export const REFETCH_DISTANCE_M = 12_000;

/** Re-download when cached data is older than this. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * When moving faster than this (m/s, ~11 mph) with a valid heading, only warn about
 * cameras roughly ahead of us, not ones we've already passed.
 */
export const HEADING_FILTER_MIN_SPEED = 5;
export const HEADING_FILTER_MAX_DELTA_DEG = 75;

export const LOCATION_TASK = 'speed-camera-location-task';
export const NOTIFICATION_CHANNEL = 'speed-camera-alerts';

/** Warn about speeding when this much over the limit (absorbs GPS speed noise): 2 mph. */
export const SPEEDING_TOLERANCE_MPS = 2 * 0.44704;

/** While still speeding toward a camera, repeat the spoken warning this often. */
export const SPEEDING_REPEAT_MS = 10_000;

/**
 * Where the pre-built camera tiles are hosted (GitHub Pages), without a trailing slash,
 * e.g. 'https://<github-user>.github.io/<repo>'. Leave empty to query OpenStreetMap
 * directly. See scripts/build-camera-tiles.mjs and .github/workflows/camera-tiles.yml.
 */
export const CAMERA_TILES_URL = '';
