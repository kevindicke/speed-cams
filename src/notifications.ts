import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as Speech from 'expo-speech';
import { Platform } from 'react-native';

import { NOTIFICATION_CHANNEL } from './config';
import { isMuted } from './settings';

/** Android fixes a channel's sound at creation, so muted alerts use a silent channel. */
const SILENT_CHANNEL = `${NOTIFICATION_CHANNEL}-silent`;

Notifications.setNotificationHandler({
  handleNotification: async (n) => ({
    // Muted alerts are scheduled without a sound, which arrives here as null.
    shouldPlaySound: n.request.content.sound != null,
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
    await Notifications.setNotificationChannelAsync(SILENT_CHANNEL, {
      name: 'Speed camera alerts (muted)',
      importance: AndroidImportance.HIGH,
      vibrationPattern: [0, 400, 200, 400],
      sound: null,
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return granted;
}

async function notify(title: string, body: string, muted: boolean) {
  const channelId = muted ? SILENT_CHANNEL : NOTIFICATION_CHANNEL;
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: muted ? false : 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      // Shows on the lock screen right away, even with a Focus (e.g. Driving) or
      // Scheduled Summary on, which otherwise hold normal notifications back.
      // Needs the Time Sensitive entitlement (paid Apple Developer account) to take effect;
      // without it iOS treats this as a normal alert.
      interruptionLevel: 'timeSensitive',
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: Platform.OS === 'android' ? { channelId } : null,
  });
}

// ---- Speech that plays even with the iPhone's silent switch on ------------------------
//
// Like navigation apps, spoken warnings use a "playback" audio session: it ignores the
// silent switch (media volume still applies) and briefly lowers music/podcasts instead of
// stopping them. The session is only active while speaking, so other audio returns to
// full volume afterwards.

let audioConfigured: Promise<void> | null = null;
let utteranceId = 0;

function configureAudio() {
  audioConfigured ??= setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: 'duckOthers',
    shouldPlayInBackground: true,
    allowsRecording: false,
  })
    .then(() => setIsAudioActiveAsync(false))
    .catch((err) => {
      audioConfigured = null; // try again next time
      console.warn('[audio] could not configure', String(err));
    });
  return audioConfigured;
}

async function speak(text: string, options: Speech.SpeechOptions = {}) {
  if (Platform.OS !== 'ios') {
    // Android speaks through the media stream, which the ringer's silent mode doesn't mute.
    Speech.speak(text, options);
    return;
  }
  await configureAudio();
  const id = ++utteranceId;
  // Only the most recent utterance releases the session, so an interrupted warning
  // finishing late can't cut off the one that replaced it.
  const release = () => {
    if (id === utteranceId) setIsAudioActiveAsync(false).catch(() => {});
  };
  await setIsAudioActiveAsync(true).catch(() => {});
  Speech.speak(text, {
    ...options,
    useApplicationAudioSession: true,
    onDone: release,
    onStopped: release,
    onError: release,
  });
}

/**
 * Camera warning. Always shows a popup; it's only audible (voice + notification sound)
 * when `audible` is true (the driver is 5+ mph over the limit) and sound isn't muted.
 */
export async function sendCameraAlert(
  title: string,
  body: string,
  spoken: string,
  { audible }: { audible: boolean },
) {
  const silent = !audible || (await isMuted());
  await notify(title, body, silent);
  if (!silent) await speak(spoken, { rate: 1.0 });
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
  const muted = await isMuted();
  if (withNotification) await notify(title, body, muted);
  if (muted) return;
  await Speech.stop();
  await speak(spoken, { rate: 1.05, pitch: 1.1, volume: 1.0 });
}
