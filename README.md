# Speed Cams

Expo / React Native app for iOS and Android. It warns you, with a notification, sound and spoken alert, when you come within **½ mile** of a speed camera. It keeps working in the background while you use another navigation app or have the screen off.

## Run it

Requires **Node ≥ 22.13** (Expo SDK 58). `nvm use` picks it up from `.nvmrc`.

Background location and task-manager don't work in Expo Go, so you need a development build:

```bash
nvm use
npx expo run:ios       # needs Xcode (accept the license: sudo xcodebuild -license)
npx expo run:android   # needs Android Studio / SDK
# or build in the cloud without local toolchains:
npx eas-cli@latest build --profile development --platform all
```

To test without driving, simulate a route: **iOS Simulator** → Features → Location → Freeway Drive / custom GPX. **Android Emulator** → Extended controls → Location → Routes.

## Map

The home screen has a **Map / List** switch. The map uses [`expo-maps`](https://docs.expo.dev/versions/v58.0.0/sdk/maps/): Apple Maps on iOS (free, no key) and Google Maps on Android ([src/components/CameraMap.tsx](src/components/CameraMap.tsx)).

**Android needs a free Google Maps API key** (the map is blank without one):
1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **Maps SDK for Android**. Google asks for a billing account, but the native mobile maps SDK isn't charged per map load.
2. Create an API key and restrict it to Android apps (package `com.speedcameras.alerts` and your signing certificate's SHA-1).
3. Add it to `app.json` under `expo.android.config.googleMaps.apiKey`, then rebuild (`npx expo run:android`).

## How it works

| File | Role |
|---|---|
| [src/locationTask.ts](src/locationTask.ts) | Background location task (`expo-task-manager` + `expo-location`), permissions |
| [src/tracker.ts](src/tracker.ts) | Takes each GPS fix → distances → alerts once per camera (re-arms after you're ¾ mi away). When moving > ~11 mph it only alerts for cameras *ahead* of your heading |
| [src/cameras.ts](src/cameras.ts) | Downloads cameras within 25 km from OpenStreetMap, caches on-device, refetches after moving 12 km or after 24 h, works offline from cache |
| [src/notifications.ts](src/notifications.ts) | Local notification + text-to-speech |
| [src/speedLimit.ts](src/speedLimit.ts) | Parses OSM `maxspeed` values; picks a camera's limit from its road when the camera has none |
| [src/config.ts](src/config.ts) | Alert radius and other tunables |

## Speeding warning

Within ½ mile of a camera ahead, if you're more than 2 mph over its limit, the app says "Slow down! Speed camera ahead. Limit 25 miles per hour" and the screen turns dark red with a "SLOW DOWN" banner. It repeats out loud every 10 s while you're still too fast (one notification per camera, so they don't pile up). The limit comes from the camera's own `maxspeed` tag, otherwise from the roads within 25 m of it (most common value, lowest on a tie). If neither has a limit, the app can't tell whether you're speeding and gives only the normal camera warning. Tune the threshold and repeat in [src/config.ts](src/config.ts).

## Camera data source

A weekly GitHub Action ([.github/workflows/camera-tiles.yml](.github/workflows/camera-tiles.yml)) runs [scripts/build-camera-tiles.mjs](scripts/build-camera-tiles.mjs). It merges these sources, treating cameras within 30 m of each other as the same camera, and publishes 1°×1° JSON tiles to GitHub Pages. The app downloads the tiles around the user (`CAMERA_TILES_URL` in [src/config.ts](src/config.ts)) and falls back to querying OpenStreetMap live if they're unreachable.

| Source | Coverage |
|---|---|
| OpenStreetMap (`highway=speed_camera`) | US-wide, about 1,500 cameras, crowd-sourced and incomplete |
| [Chicago](https://data.cityofchicago.org/d/4i42-qv3h) | 209 |
| [Washington DC (DDOT)](https://opendata.dc.gov/) | 225, with posted limits |
| [Seattle](https://data-seattlecitygis.opendata.arcgis.com/datasets/automatic-traffic-safety-cameras-atsc-active) | 77 |
| [New Orleans](https://gis.nola.gov/arcgis/rest/services/Transportation/TrafficCameraLocations/MapServer/0) | 92, with posted limits |
| [Montgomery County, MD](https://data.montgomerycountymd.gov/d/uv5p-zm58) | about 90, derived from the newest quarter of ticket data |
| [data/manual-cameras.json](data/manual-cameras.json) | Cameras you add by hand |

Official sources are defined in [scripts/official-sources.mjs](scripts/official-sources.mjs). If one fails, the build logs it and carries on without it. Cameras without a posted limit get the most common limit of roads within 25 m from OSM, when one is mapped.

**Not available as data (Nov 2026):** NYC (about 2,000 school-zone cameras), Philadelphia, Baltimore, Portland, San Francisco, Oakland, San Jose, Los Angeles, Denver and Atlanta publish locations only as PDFs, web maps or press releases. Add those to `data/manual-cameras.json`, or add a source to `official-sources.mjs` if they start publishing data. Mobile cameras (vans, trailers) aren't covered.

Licenses: OSM data is ODbL, so the in-app attribution is required. The city datasets are public open data.

## Store/legal notes
- Speed-camera warning apps are **illegal in some countries** (e.g. Germany, Switzerland, France for precise locations). Consider geo-restricting.
- Google Play requires a declaration and review for background location. Apple requires clear purpose strings (already set in `app.json`).
- iOS `audio` background mode is enabled so spoken alerts play with the screen locked. Be ready to justify it in App Review, or remove it and rely on the notification sound.
