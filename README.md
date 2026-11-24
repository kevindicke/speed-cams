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

## Sound

Spoken warnings play **even with the iPhone's silent switch on**, like navigation apps. They use a playback audio session (`expo-audio`, set up in [src/notifications.ts](src/notifications.ts)) that ignores the silent switch, follows the media volume, and briefly lowers music or podcasts while speaking. On Android, speech uses the media stream, which the ringer's silent mode doesn't mute.

The **🔊 Sound / 🔇 Muted** button next to Start alerts mutes spoken warnings and notification sounds; banners still appear. The setting is saved on the device ([src/settings.ts](src/settings.ts)) and applies to background alerts too. Notification sounds still follow the silent switch, since bypassing it needs Apple's Critical Alerts entitlement.

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

## Speed Cams Pro (RevenueCat)

| Free | Pro |
|---|---|
| Camera warnings while the app is open, map, list | Warnings in the background (screen locked, Maps/music in front) and spoken speeding warnings |

Code: [src/pro.ts](src/pro.ts) handles purchase status (saved on the device so the background task can check it), [src/components/ProPaywall.tsx](src/components/ProPaywall.tsx) is the purchase screen, and the gating is in `processLocation` in [src/tracker.ts](src/tracker.ts). **While the RevenueCat keys in [src/config.ts](src/config.ts) are empty, everyone gets Pro.**

Setup:
1. **RevenueCat:** create a free account and a project. Under *Product catalog*, create an **entitlement** with identifier `speed_cams_pro` (must match `PRO_ENTITLEMENT` in `src/config.ts`).
2. **Test without the App Store:** in *Apps and providers > Test configuration*, create Test Store products (e.g. monthly, yearly, lifetime). Attach them to the `speed_cams_pro` entitlement and to an **offering** marked *current*. Put the Test Store API key in `REVENUECAT_TEST_STORE_KEY`. It's used only in debug builds; RevenueCat crashes release builds that contain it.
3. **Real purchases:** in App Store Connect (paid developer account, *Paid Apps* agreement signed), create the matching in-app purchase / subscription products. Add the App Store app in RevenueCat, import the products into the same entitlement and offering, and put the `appl_…` public key in `REVENUECAT_IOS_KEY` (`goog_…` in `REVENUECAT_ANDROID_KEY` for Google Play).
4. Prices and options shown on the purchase screen come from the current offering, so you can change them in RevenueCat without an app update.
5. App Store Connect *App Privacy*: declare **Purchases → Purchase History** (app functionality, not used for tracking), since RevenueCat processes it. The [privacy policy](site/privacy.html) already covers this.

## Releasing to the App Store

- Builds: [eas.json](eas.json) has `preview` (internal install) and `production` profiles. Build numbers auto-increment on EAS (`appVersionSource: remote`). Bump `version` in `app.json` yourself for each release.
  ```bash
  npx eas-cli@latest build -p ios --profile production
  npx eas-cli@latest submit -p ios --latest
  ```
- iPhone only (`supportsTablet: false`). The export-compliance question is answered in config (`usesNonExemptEncryption: false`, standard HTTPS only).
- Privacy policy: [site/privacy.html](site/privacy.html), published with the camera tiles at `https://kevindicke.github.io/speed-cams/privacy.html`. Update it if the app ever starts sending data anywhere new.
- After joining the paid Apple Developer Program, replace `ios.appleTeamId` in `app.json` with the paid team's ID.

## Store/legal notes
- Speed-camera warning apps are **illegal in some countries** (e.g. Germany, Switzerland, France for precise locations). Consider geo-restricting.
- Google Play requires a declaration and review for background location. Apple requires clear purpose strings (already set in `app.json`).
- iOS `audio` background mode is enabled so spoken alerts play with the screen locked. Be ready to justify it in App Review, or remove it and rely on the notification sound.
