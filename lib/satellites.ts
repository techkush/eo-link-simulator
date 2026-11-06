import * as satellite from "satellite.js";

export const EARTH_RADIUS_KM = 6371;
export const EQ_RADIUS_KM = 6378.137;
export const MU_EARTH = 398600.4418; // km^3/s^2
export const C_KM_S = 299792.458;

export interface SatData {
  name: string;
  satrec: satellite.SatRec;
  line1: string;
  line2: string;
  noradId: string;
}

export interface SimClock {
  simMs: number;
  speed: number;
  paused: boolean;
  live: boolean;
}

export interface SatState {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
}

export interface Site {
  latDeg: number;
  lonDeg: number;
  altKm?: number;
}

export interface Look {
  azDeg: number;
  elDeg: number;
  rangeKm: number;
  /** range rate, km/s (positive = receding) */
  rangeRateKmS: number;
}

/** Parse 3-line TLE text into satrecs (dedup by NORAD id). */
export function parseTle(text: string): SatData[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.length > 0);
  const sats: SatData[] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (l1?.startsWith("1 ") && l2?.startsWith("2 ")) {
      const noradId = l1.slice(2, 7).trim();
      if (!seen.has(noradId)) {
        seen.add(noradId);
        const satrec = satellite.twoline2satrec(l1, l2);
        sats.push({ name: name.trim(), satrec, line1: l1, line2: l2, noradId });
      }
      i += 2;
    }
  }
  return sats;
}

export function propagateGeodetic(satrec: satellite.SatRec, date: Date): SatState | null {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pv.position, gmst);
  let speedKmS = 0;
  if (pv.velocity && typeof pv.velocity !== "boolean") {
    const v = pv.velocity;
    speedKmS = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }
  return {
    latDeg: satellite.degreesLat(geo.latitude),
    lonDeg: satellite.degreesLong(geo.longitude),
    altKm: geo.height,
    speedKmS,
  };
}

/** Scene frame: Earth = unit sphere; lon 0 -> +x, lon +90 -> -z, north -> +y. */
export function geodeticToScene(latDeg: number, lonDeg: number, altKm: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = 1 + altKm / EARTH_RADIUS_KM;
  return [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), -r * Math.cos(lat) * Math.sin(lon)];
}

function lookOnce(satrec: satellite.SatRec, date: Date, obs: Site) {
  const pv = satellite.propagate(satrec, date);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(pv.position, gmst);
  const la = satellite.ecfToLookAngles(
    { latitude: (obs.latDeg * Math.PI) / 180, longitude: (obs.lonDeg * Math.PI) / 180, height: obs.altKm ?? 0 },
    ecf
  );
  return { azDeg: ((la.azimuth * 180) / Math.PI + 360) % 360, elDeg: (la.elevation * 180) / Math.PI, rangeKm: la.rangeSat };
}

/** Azimuth, elevation, slant range and range-rate (finite difference over 1 s). */
export function lookAnglesFor(satrec: satellite.SatRec, date: Date, obs: Site): Look | null {
  const a = lookOnce(satrec, date, obs);
  if (!a) return null;
  const b = lookOnce(satrec, new Date(date.getTime() + 1000), obs);
  return { ...a, rangeRateKmS: b ? b.rangeKm - a.rangeKm : 0 };
}

export interface Pass {
  aos: Date;
  los: Date;
  tca: Date;
  maxElDeg: number;
  durationS: number;
  aosAzDeg: number;
  losAzDeg: number;
  minRangeKm: number;
}

/**
 * Pass prediction over `hours` from `start` above `minElDeg`.
 * Coarse 20 s scan, then AOS/LOS refined by bisection to 1 s.
 */
export function predictPasses(satrec: satellite.SatRec, start: Date, hours: number, obs: Site, minElDeg: number, maxPasses = 24): Pass[] {
  const passes: Pass[] = [];
  const stepMs = 20000;
  const endMs = start.getTime() + hours * 3600000;
  const el = (ms: number) => lookOnce(satrec, new Date(ms), obs)?.elDeg ?? -90;
  const refine = (lo: number, hi: number, rising: boolean) => {
    // invariant: f(lo) and f(hi) straddle minElDeg
    for (let k = 0; k < 16; k++) {
      const mid = (lo + hi) / 2;
      const above = el(mid) >= minElDeg;
      if (rising === above) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  let t = start.getTime();
  let prevAbove = el(t) >= minElDeg;
  let aosMs = prevAbove ? t : NaN;
  while (t < endMs && passes.length < maxPasses) {
    const tn = t + stepMs;
    const above = el(tn) >= minElDeg;
    if (above && !prevAbove) aosMs = refine(t, tn, true);
    if (!above && prevAbove && !Number.isNaN(aosMs)) {
      const losMs = refine(t, tn, false);
      // scan the pass for max elevation / min range
      let maxEl = -90, tcaMs = aosMs, minRange = Infinity;
      for (let s = aosMs; s <= losMs; s += 5000) {
        const l = lookOnce(satrec, new Date(s), obs);
        if (l && l.elDeg > maxEl) { maxEl = l.elDeg; tcaMs = s; }
        if (l && l.rangeKm < minRange) minRange = l.rangeKm;
      }
      const la = lookOnce(satrec, new Date(aosMs), obs);
      const ll = lookOnce(satrec, new Date(losMs), obs);
      passes.push({
        aos: new Date(aosMs), los: new Date(losMs), tca: new Date(tcaMs), maxElDeg: maxEl,
        durationS: (losMs - aosMs) / 1000, aosAzDeg: la?.azDeg ?? 0, losAzDeg: ll?.azDeg ?? 0, minRangeKm: minRange,
      });
      aosMs = NaN;
    }
    prevAbove = above;
    t = tn;
  }
  return passes;
}

export interface SatDetails {
  noradId: string;
  cospar: string;
  epoch: Date;
  periodMin: number;
  revsPerDay: number;
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  semiMajorKm: number;
  perigeeKm: number;
  apogeeKm: number;
  revNumber: number;
}

export function satDetails(sat: SatData): SatDetails {
  const { satrec, line1, line2 } = sat;
  const rad2deg = 180 / Math.PI;
  const intl = line1.slice(9, 17).trim();
  const yy = parseInt(intl.slice(0, 2), 10);
  const year = yy >= 57 ? 1900 + yy : 2000 + yy;
  const cospar = `${year}-${intl.slice(2, 5)}${intl.slice(5)}`;
  const nRadS = satrec.no / 60;
  const semiMajorKm = Math.cbrt(MU_EARTH / (nRadS * nRadS));
  const periodMin = (2 * Math.PI) / satrec.no;
  return {
    noradId: sat.noradId,
    cospar,
    epoch: new Date((satrec.jdsatepoch - 2440587.5) * 86400000),
    periodMin,
    revsPerDay: 1440 / periodMin,
    inclinationDeg: satrec.inclo * rad2deg,
    raanDeg: satrec.nodeo * rad2deg,
    eccentricity: satrec.ecco,
    argPerigeeDeg: satrec.argpo * rad2deg,
    semiMajorKm,
    perigeeKm: semiMajorKm * (1 - satrec.ecco) - EQ_RADIUS_KM,
    apogeeKm: semiMajorKm * (1 + satrec.ecco) - EQ_RADIUS_KM,
    revNumber: parseInt(line2.slice(63, 68), 10) || 0,
  };
}

/** Sun direction in the scene frame (low-precision solar ephemeris, ~0.01 deg). */
export function sunDirectionScene(date: Date): [number, number, number] {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const rad = Math.PI / 180;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = 23.439 * rad;
  const xEci = Math.cos(lambda), yEci = Math.cos(eps) * Math.sin(lambda), zEci = Math.sin(eps) * Math.sin(lambda);
  const gmst = satellite.gstime(date);
  const xEcef = Math.cos(gmst) * xEci + Math.sin(gmst) * yEci;
  const yEcef = -Math.sin(gmst) * xEci + Math.cos(gmst) * yEci;
  return [xEcef, zEci, -yEcef];
}

/** Great-circle distance, km (spherical Earth). */
export function greatCircleKm(a: Site, b: Site): number {
  const r = Math.PI / 180;
  const dLat = (b.latDeg - a.latDeg) * r, dLon = (b.lonDeg - a.lonDeg) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latDeg * r) * Math.cos(b.latDeg * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Half-angle (deg, at Earth's centre) of the ground footprint seen above `minElDeg` from altitude `altKm`. */
export function footprintHalfAngleDeg(altKm: number, minElDeg: number): number {
  const e = (minElDeg * Math.PI) / 180;
  const rho = Math.asin((EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altKm)) * Math.cos(e));
  return ((Math.PI / 2 - e - rho) * 180) / Math.PI;
}
