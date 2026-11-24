import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CameraMap } from './src/components/CameraMap';
import { ProPaywall } from './src/components/ProPaywall';
import { SettingsSheet } from './src/components/SettingsSheet';
import { formatMiles } from './src/geo';
import { speedInUnit } from './src/speedLimit';
import { isTracking, requestLocationPermissions, startTracking, stopTracking } from './src/locationTask';
import { setupNotifications } from './src/notifications';
import { getProSnapshot, initPurchases, purchasesEnabled, subscribePro } from './src/pro';
import { getMutedSnapshot, isMuted, setMuted, subscribeMuted } from './src/settings';
import {
  getState,
  NearbyCamera,
  preloadNearbyCameras,
  refreshCameraData,
  subscribe,
} from './src/tracker';

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  // Keep the screen on while the app is open (e.g. mounted on the dashboard while driving).
  useKeepAwake('speed-cams');
  const state = useSyncExternalStore(subscribe, getState);
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'map' | 'list'>('map');
  const pro = useSyncExternalStore(subscribePro, getProSnapshot);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const muted = useSyncExternalStore(subscribeMuted, getMutedSnapshot);

  const [refreshMessage, setRefreshMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (messageTimer.current) clearTimeout(messageTimer.current);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await refreshCameraData();
      let text: string;
      if (!result.ok) {
        text = "✕ Couldn't refresh · check your connection";
      } else if (result.added === 0 && result.removed === 0) {
        text = `✓ Up to date · ${result.total} cameras`;
      } else {
        const changes = [
          result.added ? `${result.added} new` : '',
          result.removed ? `${result.removed} removed` : '',
        ].filter(Boolean);
        text = `✓ Updated · ${changes.join(', ')}`;
      }
      setRefreshMessage({ text, ok: result.ok });
      Haptics.notificationAsync(
        result.ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      ).catch(() => {});
      if (messageTimer.current) clearTimeout(messageTimer.current);
      messageTimer.current = setTimeout(() => setRefreshMessage(null), 3000);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isTracking().then(setTracking).catch(() => setTracking(false));
    // Find and store the cameras around the user as soon as the app opens.
    preloadNearbyCameras();
    initPurchases();
    isMuted(); // load the saved mute setting
  }, []);

  const onToggle = useCallback(async () => {
    setBusy(true);
    try {
      if (tracking) {
        await stopTracking();
        setTracking(false);
        return;
      }
      const perm = await requestLocationPermissions();
      if (perm === 'denied') {
        Alert.alert(
          'Location needed',
          'Speed Cams needs access to your location to warn you about speed cameras.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }
      if (perm === 'foreground-only') {
        Alert.alert(
          'Background location off',
          'Alerts will only work while the app is open. To get alerts with the screen off or ' +
            'while using another navigation app, set location access to "Always" (iOS) or ' +
            '"Allow all the time" (Android).',
          [
            { text: 'OK', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
      }
      await setupNotifications();
      await startTracking();
      setTracking(true);
    } catch (err) {
      Alert.alert('Could not start', String(err));
    } finally {
      setBusy(false);
    }
  }, [tracking]);

  const alert = state.activeAlert;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={alert ? 'light' : 'dark'} />

      <View
        style={[
          styles.hero,
          state.speeding
            ? styles.heroSpeeding
            : alert
              ? styles.heroAlert
              : tracking
                ? styles.heroOk
                : styles.heroIdle,
        ]}
      >
        <Text style={[styles.heroLabel, alert && styles.textLight, state.speeding && styles.heroLabelBig]}>
          {state.speeding ? 'SLOW DOWN' : alert ? 'SPEED CAMERA' : tracking ? 'All clear' : 'Alerts off'}
        </Text>
        <Text style={[styles.heroValue, alert && styles.textLight]}>
          {alert
            ? formatMiles(alert.distance)
            : state.nearby[0]
              ? `Nearest: ${formatMiles(state.nearby[0].distance)}`
              : !tracking
                ? 'Tap start to begin'
                : !state.position
                  ? 'Waiting for GPS…'
                  : state.dataFetchedAt
                    ? 'No cameras nearby'
                    : 'Loading cameras…'}
        </Text>
        {alert?.limit ? (
          <Text style={[styles.heroSub, styles.textLight]}>Limit {alert.limit.label}</Text>
        ) : null}
        {state.speedMps != null && tracking ? (
          <Text style={[styles.heroSub, alert && styles.textLight, state.speeding && styles.heroSpeed]}>
            Your speed: {Math.round(speedInUnit(state.speedMps, alert?.limit?.unit ?? 'mph'))}{' '}
            {alert?.limit?.unit ?? 'mph'}
          </Text>
        ) : null}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={onToggle}
          disabled={busy}
          style={({ pressed }) => [
            styles.button,
            styles.buttonMain,
            tracking ? styles.buttonStop : styles.buttonStart,
            pressed && { opacity: 0.8 },
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{tracking ? 'Stop alerts' : 'Start alerts'}</Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => setMuted(!muted)}
          style={({ pressed }) => [
            styles.button,
            styles.soundButton,
            muted && styles.soundButtonMuted,
            pressed && { opacity: 0.8 },
          ]}
          accessibilityRole="switch"
          accessibilityLabel="Alert sound"
          accessibilityState={{ checked: !muted }}
          accessibilityHint={muted ? 'Turns spoken warnings back on' : 'Mutes spoken warnings and alert sounds'}
        >
          <Text style={styles.soundIcon}>{muted ? '🔇' : '🔊'}</Text>
          <Text style={[styles.soundLabel, muted && styles.soundLabelMuted]}>
            {muted ? 'Muted' : 'Sound'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={({ pressed }) => [styles.button, styles.soundButton, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={styles.soundIcon}>⚙️</Text>
          <Text style={styles.soundLabel}>Settings</Text>
        </Pressable>
      </View>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {purchasesEnabled && !pro ? (
        <Pressable
          onPress={() => setPaywallOpen(true)}
          style={({ pressed }) => [styles.proBanner, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          <Text style={styles.proBannerTitle}>⭐ Go Pro</Text>
          <Text style={styles.proBannerBody}>
            {tracking
              ? 'Free warnings work only while Speed Cams is open. Pro keeps warning with the screen off, plus speeding alerts.'
              : 'Warnings with the screen off and "slow down" speeding alerts.'}
          </Text>
        </Pressable>
      ) : null}
      <ProPaywall visible={paywallOpen} onClose={() => setPaywallOpen(false)} />

      <View style={styles.metaRow}>
        {refreshMessage ? (
          <Text
            style={[styles.meta, refreshMessage.ok ? styles.metaOk : styles.metaError]}
            accessibilityLiveRegion="polite"
          >
            {refreshMessage.text}
          </Text>
        ) : (
          <Text style={styles.meta}>
            {state.cameraCount} cameras loaded
            {state.dataFetchedAt ? ` · updated ${new Date(state.dataFetchedAt).toLocaleTimeString()}` : ''}
          </Text>
        )}
        {state.position ? (
          <Pressable
            onPress={onRefresh}
            disabled={refreshing}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Refresh camera data"
            accessibilityState={{ busy: refreshing, disabled: refreshing }}
          >
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        ) : null}
      </View>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Nearby cameras</Text>
        <View style={styles.segment} accessibilityRole="tablist">
          {(['map', 'list'] as const).map((v) => (
            <Pressable
              key={v}
              onPress={() => setView(v)}
              style={[styles.segmentItem, view === v && styles.segmentItemOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: view === v }}
            >
              <Text style={[styles.segmentText, view === v && styles.segmentTextOn]}>
                {v === 'map' ? 'Map' : 'List'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {view === 'map' ? (
        <View style={styles.mapWrap}>
          <CameraMap
            position={state.position}
            cameras={state.mapCameras}
            activeAlertId={state.activeAlert?.id ?? null}
            tracking={tracking}
            alertRadiusM={state.alertRadiusM}
          />
        </View>
      ) : (
      <FlatList
        data={state.nearby}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <CameraRow cam={item} showDirection={state.speedMps != null} alertRadiusM={state.alertRadiusM} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {state.error
              ? 'Camera list unavailable.'
              : !state.position
                ? 'Finding your location…'
                : state.dataFetchedAt
                  ? 'No cameras found in this area.'
                  : 'Loading cameras near you…'}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
      )}

      <Text style={styles.footer}>
        Camera data © OpenStreetMap contributors (ODbL) and city open data. Coverage varies; always obey posted limits.
      </Text>
    </SafeAreaView>
  );
}

function CameraRow({
  cam,
  showDirection,
  alertRadiusM,
}: {
  cam: NearbyCamera;
  showDirection: boolean;
  alertRadiusM: number;
}) {
  const close = cam.distance <= alertRadiusM;
  return (
    <View style={styles.row}>
      <View style={[styles.dot, close ? styles.dotAlert : !showDirection || cam.ahead ? styles.dotAhead : styles.dotBehind]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{cam.name ?? 'Speed camera'}</Text>
        <Text style={styles.rowSub}>
          {[cam.limit && `Limit ${cam.limit.label}${cam.limitSource === 'road' ? ' (road)' : ''}`, showDirection && (cam.ahead ? 'ahead' : 'behind you')]
            .filter(Boolean)
            .join(' · ') || 'Fixed camera'}
        </Text>
      </View>
      <Text style={[styles.rowDistance, close && { color: '#D92D20' }]}>{formatMiles(cam.distance)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F8', paddingHorizontal: 16 },
  hero: { marginTop: 16, borderRadius: 20, padding: 24, alignItems: 'center' },
  heroIdle: { backgroundColor: '#E9EAEC' },
  heroOk: { backgroundColor: '#D1FADF' },
  heroAlert: { backgroundColor: '#D92D20' },
  heroSpeeding: { backgroundColor: '#7A0E07', borderWidth: 4, borderColor: '#FDB022' },
  heroLabelBig: { fontSize: 22, color: '#FDB022' },
  heroSpeed: { fontSize: 22, fontWeight: '800', color: '#FDB022' },
  heroLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 1, color: '#344054' },
  heroValue: { fontSize: 36, fontWeight: '800', color: '#101828', marginTop: 6 },
  heroSub: { fontSize: 16, color: '#475467', marginTop: 6 },
  textLight: { color: '#fff' },
  button: { marginTop: 16, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  controls: { flexDirection: 'row', gap: 10, marginTop: 16 },
  buttonMain: { flex: 1, marginTop: 0, justifyContent: 'center' },
  soundButton: {
    marginTop: 0,
    width: 76,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    justifyContent: 'center',
  },
  soundButtonMuted: { backgroundColor: '#FEE4E2', borderColor: '#FDA29B' },
  soundIcon: { fontSize: 20 },
  soundLabel: { fontSize: 12, fontWeight: '600', color: '#344054', marginTop: 2 },
  soundLabelMuted: { color: '#B42318' },
  buttonStart: { backgroundColor: '#1570EF' },
  buttonStop: { backgroundColor: '#475467' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  proBanner: {
    marginTop: 10,
    backgroundColor: '#FEF0C7',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  proBannerTitle: { fontSize: 15, fontWeight: '700', color: '#93370D' },
  proBannerBody: { fontSize: 13, color: '#93370D', marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  meta: { color: '#667085', fontSize: 13 },
  metaOk: { color: '#067647', fontWeight: '600' },
  metaError: { color: '#D92D20', fontWeight: '600' },
  link: { color: '#1570EF', fontSize: 13, fontWeight: '600' },
  error: { color: '#D92D20', fontSize: 13, marginTop: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#101828' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 8,
  },
  segment: { flexDirection: 'row', backgroundColor: '#E9EAEC', borderRadius: 10, padding: 3 },
  segmentItem: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  segmentItemOn: { backgroundColor: '#fff' },
  segmentText: { fontSize: 14, fontWeight: '600', color: '#667085' },
  segmentTextOn: { color: '#101828' },
  mapWrap: { flex: 1, marginBottom: 8 },
  empty: { color: '#667085', paddingVertical: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  dotAlert: { backgroundColor: '#D92D20' },
  dotAhead: { backgroundColor: '#F79009' },
  dotBehind: { backgroundColor: '#D0D5DD' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: '#101828' },
  rowSub: { fontSize: 13, color: '#667085', marginTop: 2 },
  rowDistance: { fontSize: 16, fontWeight: '700', color: '#344054' },
  footer: { fontSize: 11, color: '#98A2B3', textAlign: 'center', paddingVertical: 8 },
});
