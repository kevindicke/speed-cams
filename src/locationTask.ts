import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { LOCATION_TASK } from './config';
import { processLocation } from './tracker';

// Must be defined at module scope, imported from index.ts before the app renders,
// so the OS can wake the JS runtime and run it while the app is in the background.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('Location task error', error.message);
      return;
    }
    const latest = data?.locations?.at(-1);
    if (latest) await processLocation(latest);
  },
);

export type PermissionResult = 'granted' | 'foreground-only' | 'denied';

export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'granted' : 'foreground-only';
}

export async function startTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 25, // meters between updates
    timeInterval: 2000, // Android
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Speed Cams is active',
      notificationBody: 'Watching for speed cameras within ½ mile.',
      notificationColor: '#D92D20',
    },
  });
}

export async function stopTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export function isTracking() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}
