// Where the sun is on a day: azimuth (degrees from north, clockwise) and elevation, by the
// NOAA solar position formulas (good to well under a degree, plenty for a drawing).

const rad = Math.PI / 180;

export interface SunPoint {
  time: Date;
  azimuth: number;
  elevation: number;
}

/** The sun's position at a moment, seen from latitude/longitude (degrees). */
export function sunPosition(date: Date, latitude: number, longitude: number): { azimuth: number; elevation: number } {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * m * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * m * rad) * 0.000289;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * t) * rad);
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * t) * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime = 4 / rad * (y * Math.sin(2 * l0 * rad) - 2 * e * Math.sin(m * rad) + 4 * e * y * Math.sin(m * rad) * Math.cos(2 * l0 * rad) - 0.5 * y * y * Math.sin(4 * l0 * rad) - 1.25 * e * e * Math.sin(2 * m * rad));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const solar = (((minutes + eqTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hour = solar / 4 < 0 ? solar / 4 + 180 : solar / 4 - 180;
  const lat = latitude * rad;
  const zenith = Math.acos(Math.max(-1, Math.min(1, Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hour * rad))));
  const az = Math.atan2(Math.sin(hour * rad), Math.cos(hour * rad) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / rad + 180;
  return { azimuth: (az + 360) % 360, elevation: 90 - zenith / rad };
}

/**
 * Today's path above the horizon, every `step` minutes, from just before sunrise to just
 * after sunset (empty in the polar night).
 */
export function sunPath(day: Date, latitude: number, longitude: number, step = 10): SunPoint[] {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const all: SunPoint[] = [];
  for (let m = 0; m <= 1440; m += step) {
    const time = new Date(start.getTime() + m * 60000);
    all.push({ time, ...sunPosition(time, latitude, longitude) });
  }
  const first = all.findIndex((p) => p.elevation > 0);
  if (first < 0) return [];
  let last = all.length - 1;
  while (last > first && all[last].elevation <= 0) last--;
  return all.slice(Math.max(0, first - 1), Math.min(all.length, last + 2));
}
