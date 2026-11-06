/**
 * Contact prediction that propagates the satellite ONCE per time step and evaluates every observer
 * (ground station, data centre, target) from that position; GEO-relay line-of-sight is evaluated
 * from the same ECEF position. 24 h at 20 s = 4,320 SGP4 calls (~0.1 s) regardless of observer count.
 */
import * as satellite from "satellite.js";
import { EARTH_RADIUS_KM, type Site } from "./satellites";
import { GEO_ALT_KM } from "./catalog";

export interface Observer extends Site {
  id: string;
  minElDeg: number;
}

export interface Contact {
  observerId: string;
  aos: Date;
  los: Date;
  tca: Date;
  maxElDeg: number;
  durationS: number;
  minRangeKm: number;
  aosAzDeg: number;
  losAzDeg: number;
}

export interface GeoWindow {
  relayName: string;
  start: Date;
  end: Date;
}

type Ecf = { x: number; y: number; z: number };

function ecfAt(satrec: satellite.SatRec, ms: number): Ecf | null {
  const d = new Date(ms);
  const pv = satellite.propagate(satrec, d);
  if (!pv || !pv.position || typeof pv.position === "boolean") return null;
  return satellite.eciToEcf(pv.position, satellite.gstime(d));
}

function look(ecf: Ecf, o: Observer) {
  const la = satellite.ecfToLookAngles(
    { latitude: (o.latDeg * Math.PI) / 180, longitude: (o.lonDeg * Math.PI) / 180, height: o.altKm ?? 0 },
    ecf
  );
  return { el: (la.elevation * 180) / Math.PI, az: ((la.azimuth * 180) / Math.PI + 360) % 360, range: la.rangeSat };
}

/** True when the straight line from the LEO position to a GEO slot at `lonDeg` clears the Earth (+60 km). */
export function geoVisible(ecf: Ecf, lonDeg: number): boolean {
  const R = EARTH_RADIUS_KM + GEO_ALT_KM;
  const l = (lonDeg * Math.PI) / 180;
  const g = { x: R * Math.cos(l), y: R * Math.sin(l), z: 0 };
  const dx = g.x - ecf.x, dy = g.y - ecf.y, dz = g.z - ecf.z;
  const L2 = dx * dx + dy * dy + dz * dz;
  const t = -(ecf.x * dx + ecf.y * dy + ecf.z * dz) / L2; // parameter of closest approach to origin
  if (t <= 0 || t >= 1) return true;
  const cx = ecf.x + t * dx, cy = ecf.y + t * dy, cz = ecf.z + t * dz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) > EARTH_RADIUS_KM + 60;
}

export function geoRangeKm(ecf: Ecf, lonDeg: number): number {
  const R = EARTH_RADIUS_KM + GEO_ALT_KM;
  const l = (lonDeg * Math.PI) / 180;
  const dx = R * Math.cos(l) - ecf.x, dy = R * Math.sin(l) - ecf.y, dz = -ecf.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function predictContacts(
  satrec: satellite.SatRec,
  start: Date,
  hours: number,
  observers: Observer[],
  relays: { name: string; lonDeg: number }[] = [],
  stepS = 20
): { contacts: Contact[]; geoWindows: GeoWindow[] } {
  const contacts: Contact[] = [];
  const geoWindows: GeoWindow[] = [];
  const stepMs = stepS * 1000;
  const t0 = start.getTime();
  const endMs = t0 + hours * 3600000;

  const elAt = (ms: number, o: Observer) => {
    const e = ecfAt(satrec, ms);
    return e ? look(e, o).el : -90;
  };
  const refine = (lo: number, hi: number, o: Observer, rising: boolean) => {
    for (let k = 0; k < 14; k++) {
      const mid = (lo + hi) / 2;
      const above = elAt(mid, o) >= o.minElDeg;
      if (rising === above) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  const state = observers.map(() => ({ above: false, aosMs: NaN, maxEl: -90, tcaMs: 0, minRange: Infinity }));
  const geoState = relays.map(() => ({ vis: false, startMs: NaN }));

  let first = true;
  for (let t = t0; t <= endMs; t += stepMs) {
    const e = ecfAt(satrec, t);
    if (!e) continue;
    observers.forEach((o, i) => {
      const s = state[i];
      const lk = look(e, o);
      const above = lk.el >= o.minElDeg;
      if (above) {
        if (!s.above) {
          s.aosMs = first ? t : refine(t - stepMs, t, o, true);
          s.maxEl = -90; s.minRange = Infinity;
        }
        if (lk.el > s.maxEl) { s.maxEl = lk.el; s.tcaMs = t; }
        if (lk.range < s.minRange) s.minRange = lk.range;
      } else if (s.above) {
        const losMs = refine(t - stepMs, t, o, false);
        const ea = ecfAt(satrec, s.aosMs), el = ecfAt(satrec, losMs);
        contacts.push({
          observerId: o.id, aos: new Date(s.aosMs), los: new Date(losMs), tca: new Date(s.tcaMs),
          maxElDeg: s.maxEl, durationS: (losMs - s.aosMs) / 1000, minRangeKm: s.minRange,
          aosAzDeg: ea ? look(ea, o).az : 0, losAzDeg: el ? look(el, o).az : 0,
        });
      }
      s.above = above;
    });
    relays.forEach((r, i) => {
      const g = geoState[i];
      const vis = geoVisible(e, r.lonDeg);
      if (vis && !g.vis) g.startMs = t;
      if (!vis && g.vis) geoWindows.push({ relayName: r.name, start: new Date(g.startMs), end: new Date(t) });
      g.vis = vis;
    });
    first = false;
  }
  // close open windows at the horizon of the prediction
  observers.forEach((o, i) => {
    const s = state[i];
    if (s.above && !Number.isNaN(s.aosMs)) {
      contacts.push({
        observerId: o.id, aos: new Date(s.aosMs), los: new Date(endMs), tca: new Date(s.tcaMs), maxElDeg: s.maxEl,
        durationS: (endMs - s.aosMs) / 1000, minRangeKm: s.minRange, aosAzDeg: 0, losAzDeg: 0,
      });
    }
  });
  relays.forEach((r, i) => {
    const g = geoState[i];
    if (g.vis) geoWindows.push({ relayName: r.name, start: new Date(g.startMs), end: new Date(endMs) });
  });
  contacts.sort((a, b) => a.aos.getTime() - b.aos.getTime());
  geoWindows.sort((a, b) => a.start.getTime() - b.start.getTime());
  return { contacts, geoWindows };
}

/** Minimum elevation seen from the target that corresponds to a maximum off-nadir pointing angle. */
export function minElForOffNadir(altKm: number, offNadirDeg: number): number {
  const eta = (offNadirDeg * Math.PI) / 180;
  const cosE = (Math.sin(eta) * (EARTH_RADIUS_KM + altKm)) / EARTH_RADIUS_KM;
  if (cosE >= 1) return 0;
  return (Math.acos(cosE) * 180) / Math.PI;
}
