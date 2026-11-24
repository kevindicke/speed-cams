// Official speed camera datasets published by US cities and counties.
//
// Each source returns cameras as { key, lat, lon, maxspeed?, name? }, where `key` is
// stable within the source and `maxspeed` uses OSM syntax ("25 mph").
//
// Only programs that publish machine-readable coordinates are here. As of Nov 2026,
// NYC, Philadelphia, Baltimore, Portland, San Francisco, Oakland, San Jose,
// Los Angeles, Denver and Atlanta publish locations only as PDFs or web maps.
// Cameras for those can be added by hand in data/manual-cameras.json.

const UA = { 'User-Agent': 'SpeedCams-tile-builder/1.0 (GitHub Actions)' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** All features of an ArcGIS layer (follows paging), with WGS84 geometry. */
async function arcgis(layerUrl, where) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      where,
      outFields: '*',
      returnGeometry: 'true',
      outSR: '4326',
      f: 'json',
      resultOffset: String(offset),
      resultRecordCount: '1000',
    });
    const json = await getJson(`${layerUrl}/query?${params}`);
    if (json.error) throw new Error(json.error.message);
    out.push(...json.features);
    if (!json.exceededTransferLimit) return out;
  }
}

const mph = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `${n} mph` : undefined;
};
const valid = (c) =>
  Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.lat !== 0 && c.lon !== 0;

export const OFFICIAL_SOURCES = [
  {
    id: 'chicago',
    name: 'City of Chicago (data.cityofchicago.org)',
    async fetch() {
      const rows = await getJson('https://data.cityofchicago.org/resource/4i42-qv3h.json?$limit=5000');
      const now = Date.now();
      return rows
        .filter((r) => !r.go_live_date || Date.parse(r.go_live_date) <= now)
        .map((r) => ({
          key: r.location_id ?? r.id,
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          name: r.address,
        }));
    },
  },
  {
    id: 'dc',
    name: 'DDOT Automated Safety Cameras (opendata.dc.gov)',
    async fetch() {
      const features = await arcgis(
        'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Public_Safety_WebMercator/MapServer/43',
        "ENFORCEMENT_TYPE='Speed' AND ACTIVE_STATUS='Active'",
      );
      return features.map(({ attributes: a, geometry: g }) => ({
        key: a.ENFORCEMENT_SPACE_CODE ?? a.OBJECTID,
        lat: a.CAMERA_LATITUDE ?? g?.y,
        lon: a.CAMERA_LONGITUDE ?? g?.x,
        maxspeed: mph(a.SPEED_LIMIT),
        name: a.LOCATION_DESCRIPTION,
      }));
    },
  },
  {
    id: 'seattle',
    name: 'Seattle Automatic Traffic Safety Cameras (data.seattle.gov)',
    async fetch() {
      const features = await arcgis(
        'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Automatic_Traffic_Safety_Cameras_(ATSC)_view/FeatureServer/0',
        "Camera_Type IN ('Fixed School Zone','Full-Time Speed')",
      );
      return features.map(({ attributes: a, geometry: g }) => ({
        key: a.Location_ID ?? a.ObjectId,
        lat: a.Cam_Lat ?? g?.y,
        lon: a.Cam_Long ?? g?.x,
        // School zones are 20 mph when the beacons flash.
        maxspeed: a.Camera_Type === 'Fixed School Zone' ? '20 mph' : undefined,
        name: a.SPD_Camera_Name,
      }));
    },
  },
  {
    id: 'new-orleans',
    name: 'City of New Orleans traffic cameras (gis.nola.gov)',
    async fetch() {
      const features = await arcgis(
        'https://gis.nola.gov/arcgis/rest/services/Transportation/TrafficCameraLocations/MapServer/0',
        "Operational='Y' AND (SpeedEnforcement IS NOT NULL OR SZEnforcement IS NOT NULL)",
      );
      return features.map(({ attributes: a, geometry: g }) => ({
        key: (a.Site_ID ?? '').trim() || a.OBJECTID,
        lat: a.Latitude ?? g?.y,
        lon: a.Longitude ?? g?.x,
        // Warn against the lower school-zone limit where one applies.
        maxspeed: mph(a.SZSpeedLimit) ?? mph(a.RegSpeedLimit),
        name: a.Location,
      }));
    },
  },
  {
    id: 'montgomery-md',
    name: 'Montgomery County MD speed camera sites (data.montgomerycountymd.gov)',
    async fetch() {
      // Published as tickets per camera site per quarter; use the newest quarter.
      const base = 'https://data.montgomerycountymd.gov/resource/uv5p-zm58.json';
      const [latest] = await getJson(
        `${base}?$select=quarter_name&$group=quarter_name&$order=quarter_name DESC&$limit=1`,
      );
      const rows = await getJson(
        `${base}?$where=${encodeURIComponent(`quarter_name='${latest.quarter_name}'`)}&$limit=5000`,
      );
      return rows
        .filter((r) => Number(r.total) > 0)
        .map((r) => ({
          key: `${r.site_number}-${r.directions ?? ''}`,
          lat: Number(r.latitude),
          lon: Number(r.longitude),
          name: r.address,
        }));
    },
  },
];

/** Runs every source; a failing source is logged and skipped, never fatal. */
export async function fetchOfficialCameras() {
  const all = [];
  for (const source of OFFICIAL_SOURCES) {
    try {
      const cams = (await source.fetch()).filter(valid);
      console.log(`  ${source.id}: ${cams.length} cameras`);
      for (const c of cams) all.push({ ...c, source: source.id });
    } catch (err) {
      console.warn(`  ${source.id}: FAILED (${err.message}); skipping this source`);
    }
  }
  return all;
}
