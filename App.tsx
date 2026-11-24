import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
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

import { ALERT_RADIUS_M } from './src/config';
import { formatMiles } from './src/geo';
import { speedInUnit } from './src/speedLimit';
import { isTracking, requestLocationPermissions, startTracking, stopTracking } from './src/locationTask';
import { setupNotifications } from './src/notifications';
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
  const state = useSyncExternalStore(subscribe, getState);
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    isTracking().then(setTracking).catch(() => setTracking(false));
    // Find and store the cameras around the user as soon as the app opens.
    preloadNearbyCameras();
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

      <Pressable
        onPress={onToggle}
        disabled={busy}
        style={({ pressed }) => [
          styles.button,
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

      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {state.cameraCount} cameras loaded
          {state.dataFetchedAt ? ` · updated ${new Date(state.dataFetchedAt).toLocaleTimeString()}` : ''}
        </Text>
        {state.position ? (
          <Pressable onPress={refreshCameraData} hitSlop={8}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        ) : null}
      </View>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

      <Text style={styles.sectionTitle}>Nearby cameras</Text>
      <FlatList
        data={state.nearby}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => <CameraRow cam={item} showDirection={state.speedMps != null} />}
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

      <Text style={styles.footer}>
        Camera data © OpenStreetMap contributors (ODbL). Coverage varies; always obey posted limits.
      </Text>
    </SafeAreaView>
  );
}

function CameraRow({ cam, showDirection }: { cam: NearbyCamera; showDirection: boolean }) {
  const close = cam.distance <= ALERT_RADIUS_M;
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
  buttonStart: { backgroundColor: '#1570EF' },
  buttonStop: { backgroundColor: '#475467' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  meta: { color: '#667085', fontSize: 13 },
  link: { color: '#1570EF', fontSize: 13, fontWeight: '600' },
  error: { color: '#D92D20', fontSize: 13, marginTop: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8, color: '#101828' },
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
