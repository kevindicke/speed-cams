import { METERS_PER_MILE } from "./geo";

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

export const LOCATION_TASK = "speed-camera-location-task";
export const NOTIFICATION_CHANNEL = "speed-camera-alerts";

/** Warn about speeding when this much over the limit (absorbs GPS speed noise): 2 mph. */
export const SPEEDING_TOLERANCE_MPS = 2 * 0.44704;

/** While still speeding toward a camera, repeat the spoken warning this often. */
export const SPEEDING_REPEAT_MS = 10_000;

/** Map shows cameras within this distance of you, capped for performance. */
export const MAP_RADIUS_M = 10_000;
export const MAP_MAX_MARKERS = 300;

/**
 * Where the pre-built camera tiles are hosted (GitHub Pages), without a trailing slash,
 * e.g. 'https://<github-user>.github.io/<repo>'. Leave empty to query OpenStreetMap
 * directly. See scripts/build-camera-tiles.mjs and .github/workflows/camera-tiles.yml.
 */
export const CAMERA_TILES_URL = "https://kevindicke.github.io/speed-cams/";

/**
 * RevenueCat public SDK keys (safe to commit). Find them in the RevenueCat dashboard under
 * Project settings > API keys. While both platform keys are empty, purchases are disabled
 * and every user gets Pro features.
 *
 * The Test Store key is used only in development builds (__DEV__): RevenueCat makes release
 * builds crash on purpose if they contain it.
 */
export const REVENUECAT_IOS_KEY = "";
export const REVENUECAT_ANDROID_KEY = "";
export const REVENUECAT_TEST_STORE_KEY = "test_izLnlVHqqWOHcENYoJRHdqiAqKJ";

/** Entitlement identifier configured in RevenueCat that unlocks Pro. */
export const PRO_ENTITLEMENT = 'speed_cams_pro';
