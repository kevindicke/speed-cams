import { AppleMaps, GoogleMaps } from 'expo-maps';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ALERT_RADIUS_M } from '../config';
import { distanceMeters, formatMiles, LatLng } from '../geo';
import type { NearbyCamera } from '../tracker';

type Props = {
  position: LatLng | null;
  cameras: NearbyCamera[];
  /** Camera currently being warned about, highlighted in red. */
  activeAlertId: string | null;
  /** Whether alerts are running (shows the ½-mile warning ring around you). */
  tracking: boolean;
};

const DEFAULT_ZOOM = 13;
// Center of the contiguous US, used until we know where the user is.
const US_CENTER = { latitude: 39.5, longitude: -98.35 };

const COLORS = {
  alert: '#D92D20',
  ahead: '#F79009',
  behind: '#98A2B3',
  ring: 'rgba(21, 112, 239, 0.12)',
  ringLine: 'rgba(21, 112, 239, 0.6)',
};

function label(cam: NearbyCamera) {
  const limit = cam.limit ? `Limit ${cam.limit.label}` : 'Limit unknown';
  return { title: cam.name ?? 'Speed camera', detail: `${limit} · ${formatMiles(cam.distance)}` };
}

export function CameraMap({ position, cameras, activeAlertId, tracking }: Props) {
  const appleRef = useRef<AppleMaps.MapView>(null);
  const googleRef = useRef<GoogleMaps.MapView>(null);
  const [following, setFollowing] = useState(true);
  const zoom = useRef(DEFAULT_ZOOM);
  const lastProgrammaticMove = useRef(0);

  // Keep the map centered on the user while "following"; panning the map turns it off.
  useEffect(() => {
    if (!following || !position) return;
    lastProgrammaticMove.current = Date.now();
    const target = { coordinates: position, zoom: zoom.current };
    // Rejects if the native map isn't mounted yet; the next location update retries.
    const move =
      Platform.OS === 'ios'
        ? appleRef.current?.setCameraPosition(target)
        : googleRef.current?.setCameraPosition({ ...target, duration: 300 });
    move?.catch(() => {});
  }, [following, position]);

  const onCameraMove = (e: { coordinates: { latitude?: number; longitude?: number }; zoom: number }) => {
    zoom.current = e.zoom;
    if (!position || e.coordinates.latitude == null || e.coordinates.longitude == null) return;
    // Ignore moves we caused; a user pan that leaves our position stops following.
    if (Date.now() - lastProgrammaticMove.current < 1500) return;
    const center = { latitude: e.coordinates.latitude, longitude: e.coordinates.longitude };
    if (distanceMeters(center, position) > 150) setFollowing(false);
  };

  const circles = useMemo(
    () =>
      position && tracking
        ? [
            {
              id: 'alert-radius',
              center: position,
              radius: ALERT_RADIUS_M,
              color: COLORS.ring,
              lineColor: COLORS.ringLine,
              lineWidth: 1,
            },
          ]
        : [],
    [position, tracking],
  );

  const appleMarkers = useMemo<AppleMaps.Marker[]>(
    () =>
      cameras.map((cam) => {
        const { title, detail } = label(cam);
        return {
          id: cam.id,
          coordinates: { latitude: cam.latitude, longitude: cam.longitude },
          title: `${title} · ${detail}`,
          systemImage: 'camera.fill',
          tintColor:
            cam.id === activeAlertId ? COLORS.alert : cam.ahead ? COLORS.ahead : COLORS.behind,
        };
      }),
    [cameras, activeAlertId],
  );

  const googleMarkers = useMemo<GoogleMaps.Marker[]>(
    () =>
      cameras.map((cam) => {
        const { title, detail } = label(cam);
        return {
          id: cam.id,
          coordinates: { latitude: cam.latitude, longitude: cam.longitude },
          title,
          snippet: detail,
          zIndex: cam.id === activeAlertId ? 2 : 1,
        };
      }),
    [cameras, activeAlertId],
  );

  const initialCamera = {
    coordinates: position ?? US_CENTER,
    zoom: position ? DEFAULT_ZOOM : 3,
  };

  return (
    <View style={styles.container}>
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          ref={appleRef}
          style={StyleSheet.absoluteFill}
          cameraPosition={initialCamera}
          markers={appleMarkers}
          circles={circles}
          properties={{ isMyLocationEnabled: true, isTrafficEnabled: false }}
          uiSettings={{ compassEnabled: true, scaleBarEnabled: true, myLocationButtonEnabled: false }}
          onCameraMove={onCameraMove}
        />
      ) : Platform.OS === 'android' ? (
        <GoogleMaps.View
          ref={googleRef}
          style={StyleSheet.absoluteFill}
          cameraPosition={initialCamera}
          markers={googleMarkers}
          circles={circles}
          properties={{ isMyLocationEnabled: true }}
          uiSettings={{ compassEnabled: true, myLocationButtonEnabled: false, zoomControlsEnabled: false }}
          onCameraMove={onCameraMove}
        />
      ) : (
        <Text style={styles.unsupported}>Maps are available on iOS and Android.</Text>
      )}

      {!following && position ? (
        <Pressable
          onPress={() => setFollowing(true)}
          style={({ pressed }) => [styles.recenter, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
          accessibilityLabel="Re-center map on my location"
        >
          <Text style={styles.recenterText}>Re-center</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#E9EAEC' },
  unsupported: { margin: 16, color: '#667085' },
  recenter: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    backgroundColor: '#1570EF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  recenterText: { color: '#fff', fontWeight: '700' },
});
