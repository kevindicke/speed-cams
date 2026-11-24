import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { NOTIFICATION_CHANNEL } from './config';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function setupNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Must exist before the permission prompt can appear on Android 13+.
    await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
      name: 'Speed camera alerts',
      importance: AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      sound: 'default',
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return granted;
}

async function notify(title: string, body: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      ...(Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL } : {}),
    },
    trigger: Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL } : null,
  });
}

export async function sendCameraAlert(title: string, body: string, spoken: string) {
  await notify(title, body);
  Speech.speak(spoken, { rate: 1.0 });
}

/**
 * Urgent spoken "slow down" warning. Interrupts anything already being spoken so the
 * driver hears it immediately. The notification is optional so repeats stay voice-only.
 */
export async function sendSpeedingAlert(
  title: string,
  body: string,
  spoken: string,
  { withNotification }: { withNotification: boolean },
) {
  await Speech.stop();
  if (withNotification) await notify(title, body);
  Speech.speak(spoken, { rate: 1.05, pitch: 1.1, volume: 1.0 });
}
