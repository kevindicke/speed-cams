export const MPS_PER_MPH = 0.44704;
const MPS_PER_KMH = 1 / 3.6;
const MPS_PER_KNOT = 0.514444;

export type SpeedLimit = {
  /** Limit in meters per second. */
  mps: number;
  /** Human-readable, e.g. "30 mph" or "50 km/h". */
  label: string;
  unit: 'mph' | 'km/h' | 'knots';
};

/**
 * Parses an OpenStreetMap `maxspeed` value. Plain numbers are km/h per OSM convention;
 * "30 mph" and "50 km/h" are explicit. Values like "none", "signals" or "US:urban"
 * carry no number and return undefined.
 */
export function parseMaxspeed(value: string | undefined): SpeedLimit | undefined {
  if (!value) return undefined;
  // "50;30" (multiple values) — use the first.
  const m = value.split(';')[0].trim().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph|knots)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = (m[2] ?? 'km/h').toLowerCase();
  if (unit === 'mph') return { mps: n * MPS_PER_MPH, label: `${n} mph`, unit: 'mph' };
  if (unit === 'knots') return { mps: n * MPS_PER_KNOT, label: `${n} knots`, unit: 'knots' };
  return { mps: n * MPS_PER_KMH, label: `${n} km/h`, unit: 'km/h' };
}

/**
 * Picks one limit from the roads around a camera: the most common value, and the
 * lowest on a tie, so an ambiguous junction errs toward warning the driver.
 */
export function pickRoadLimit(values: (string | undefined)[]): SpeedLimit | undefined {
  const counts = new Map<string, { limit: SpeedLimit; count: number }>();
  for (const v of values) {
    const limit = parseMaxspeed(v);
    if (!limit) continue;
    const entry = counts.get(limit.label);
    if (entry) entry.count += 1;
    else counts.set(limit.label, { limit, count: 1 });
  }
  let best: { limit: SpeedLimit; count: number } | undefined;
  for (const entry of counts.values()) {
    if (
      !best ||
      entry.count > best.count ||
      (entry.count === best.count && entry.limit.mps < best.limit.mps)
    ) {
      best = entry;
    }
  }
  return best?.limit;
}

/** Converts m/s to the same unit the limit is posted in, for display and speech. */
export function speedInUnit(mps: number, unit: SpeedLimit['unit']): number {
  if (unit === 'mph') return mps / MPS_PER_MPH;
  if (unit === 'knots') return mps / MPS_PER_KNOT;
  return mps / MPS_PER_KMH;
}
