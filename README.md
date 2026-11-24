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

**Current: OpenStreetMap via the Overpass API** (free, global, no key). Fixed cameras are tagged `highway=speed_camera`, often with `maxspeed`. Coverage is good in much of Europe and in US cities with camera programs (e.g. DC ~200, NYC ~60, Chicago ~27 in OSM), but it is crowd-sourced and can be incomplete. License: ODbL, so the in-app attribution is required.

Public Overpass servers are rate-limited and meant for light use. Before shipping to many users, do one of these:
- Run a backend job that pulls cameras for your regions (Overpass or a [Geofabrik](https://download.geofabrik.de/) extract filtered with `osmium tags-filter`), then serve a static JSON/GeoJSON from a CDN and point `cameras.ts` at it.
- Or host your own Overpass instance.

**Other sources to merge in:**
- **City open-data portals** (official, authoritative): e.g. Chicago "Speed Camera Locations" (data.cityofchicago.org), NYC DOT, Washington DC Open Data "Automated Traffic Enforcement", Montgomery County MD. Most are Socrata/ArcGIS APIs that return JSON with lat/lon.
- **SCDB.info**: a commercial worldwide database (fixed and mobile) that you license for app use.
- **Waze**: has no public API for police/camera reports, and scraping it breaks its ToS.

## Store/legal notes
- Speed-camera warning apps are **illegal in some countries** (e.g. Germany, Switzerland, France for precise locations). Consider geo-restricting.
- Google Play requires a declaration and review for background location. Apple requires clear purpose strings (already set in `app.json`).
- iOS `audio` background mode is enabled so spoken alerts play with the screen locked. Be ready to justify it in App Review, or remove it and rely on the notification sound.
