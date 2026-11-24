export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export const METERS_PER_MILE = 1609.344;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north (0–360). */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δλ = toRad(b.longitude - a.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two headings, 0–180. */
export function headingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Bounding box [south, west, north, east] of a square around a point. */
export function boundingBox(center: LatLng, radiusMeters: number): [number, number, number, number] {
  const dLat = toDeg(radiusMeters / EARTH_RADIUS_M);
  const dLon = toDeg(radiusMeters / (EARTH_RADIUS_M * Math.cos(toRad(center.latitude))));
  return [
    center.latitude - dLat,
    center.longitude - dLon,
    center.latitude + dLat,
    center.longitude + dLon,
  ];
}

export function formatMiles(meters: number): string {
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(miles < 10 ? 2 : 1)} mi`;
}
