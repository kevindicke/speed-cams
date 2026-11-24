import Storage from 'expo-sqlite/kv-store';

/**
 * Whether camera alerts are muted (no spoken warnings or notification sounds; banners
 * still appear). Saved on the device so the background location task respects it too.
 */
const MUTED_KEY = 'alerts-muted-v1';

let muted = false;
let loaded = false;
const listeners = new Set<() => void>();

export async function isMuted(): Promise<boolean> {
  if (!loaded) {
    try {
      muted = (await Storage.getItem(MUTED_KEY)) === '1';
    } catch {
      muted = false;
    }
    loaded = true;
    listeners.forEach((fn) => fn());
  }
  return muted;
}

export function getMutedSnapshot() {
  return muted;
}

export function subscribeMuted(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function setMuted(value: boolean) {
  muted = value;
  loaded = true;
  listeners.forEach((fn) => fn());
  await Storage.setItem(MUTED_KEY, value ? '1' : '0');
}
