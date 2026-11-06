/**
 * On-board recorder queue estimate for Sentinel-2 from the public acquisition plan.
 * Arrivals: each datatake adds duration x 490 Mbit/s (ESA: MSI rate after on-board wavelet compression).
 * Service: X-band playback at 560 Mbit/s during predicted passes over the Copernicus core X-band stations,
 * plus EDRS laser relay at 1.8 Gbit/s while EDRS-A/C are in line of sight, capped at EDRS_MIN_PER_ORBIT.
 * The recorder holds 2.4 Tbit (300 GB).  Output: queue level over time and the current estimate.
 */
import type { Contact, GeoWindow } from "./passes";

export interface Datatake { id: string; start: string; stop: string; durS: number; scenes: number; mode: string; style: string; orbit: number }

export const S2_COMPRESSED_BPS = 490e6;     // ESA Sentinel-2 User Handbook / MSI papers: 490 Mbit/s after compression
export const S2_PLAYBACK_BPS = 560e6;       // eoPortal: 560 Mbit/s X-band (2 x 280)
export const S2_EDRS_BPS = 1.8e9;           // ESA EDRS
export const S2_MEMORY_BITS = 2.4e12;       // eoPortal: 2.4 Tbit mass memory
export const S2_CORE_STATION_IDS = ["matera", "maspalomas", "svalbard", "inuvik"];
export const EDRS_MIN_PER_ORBIT = 25;
export const S2_PERIOD_S = 6035;            // 100.6 min

export interface QueuePoint { t: number; bits: number; event?: string }

export interface QueueEstimate {
  nowBits: number;
  series: QueuePoint[];
  /** when the queue is next empty after `now`, or null if never within the horizon */
  drainsAt: Date | null;
  drainVia: string | null;
  lastDatatake: Datatake | null;
  nextDatatake: Datatake | null;
  arrivalsLast24hBits: number;
  nrtCount: number;
}

export function estimateQueue(
  datatakes: Datatake[], contacts: Contact[], geoWindows: GeoWindow[], stationNames: Record<string, string>,
  now: Date, fromMs: number, toMs: number, stepS = 30
): QueueEstimate {
  const dts = datatakes.map((d) => ({ ...d, s: Date.parse(d.start + "Z"), e: Date.parse(d.stop + "Z") })).filter((d) => d.e > fromMs - 86400000 && d.s < toMs).sort((a, b) => a.s - b.s);
  const xb = contacts.filter((c) => S2_CORE_STATION_IDS.includes(c.observerId)).map((c) => ({ s: c.aos.getTime(), e: c.los.getTime(), name: stationNames[c.observerId] ?? c.observerId }));
  const edrs = geoWindows.map((w) => ({ s: w.start.getTime(), e: w.end.getTime(), name: w.relayName.split(" (")[0] }));
  const series: QueuePoint[] = [];
  let q = 0;
  // warm start: assume the queue was empty 24 h before the window and run from there
  let t = fromMs - 86400000;
  let periodStart = t, edrsUsed = 0;
  const stepMs = stepS * 1000;
  let drainsAt: Date | null = null, drainVia: string | null = null, nowBits = 0, arrivals24 = 0;
  let wasPositiveAfterNow = false;
  const nowMs = now.getTime();
  while (t <= toMs) {
    // arrivals during [t, t+step)
    let arr = 0;
    for (const d of dts) { if (d.e <= t) continue; if (d.s >= t + stepMs) break; arr += (Math.min(d.e, t + stepMs) - Math.max(d.s, t)) / 1000 * S2_COMPRESSED_BPS; }
    q += arr;
    if (t >= nowMs - 86400000 && t < nowMs) arrivals24 += arr;
    // service
    if (t - periodStart >= S2_PERIOD_S * 1000) { periodStart += S2_PERIOD_S * 1000; edrsUsed = 0; }
    let via: string | undefined;
    const x = xb.find((c) => t >= c.s && t < c.e);
    if (x && q > 0) { q = Math.max(0, q - S2_PLAYBACK_BPS * stepS); via = x.name; }
    const g = edrs.find((w) => t >= w.s && t < w.e);
    if (g && q > 0 && edrsUsed < EDRS_MIN_PER_ORBIT * 60) { q = Math.max(0, q - S2_EDRS_BPS * stepS); edrsUsed += stepS; via = via ? `${via} + ${g.name}` : g.name; }
    q = Math.min(q, S2_MEMORY_BITS);
    if (t >= fromMs) series.push({ t, bits: q, event: via });
    if (t <= nowMs && t + stepMs > nowMs) nowBits = q;
    if (t >= nowMs) { if (q > 0) wasPositiveAfterNow = true; if (q === 0 && wasPositiveAfterNow && !drainsAt) { drainsAt = new Date(t); drainVia = via ?? series[series.length - 2]?.event ?? null; } }
    t += stepMs;
  }
  if (nowBits === 0 && !drainsAt) { drainsAt = now; }
  const last = dts.filter((d) => d.e <= nowMs).pop() ?? null;
  const next = dts.find((d) => d.s > nowMs) ?? null;
  return { nowBits, series, drainsAt, drainVia, lastDatatake: last, nextDatatake: next, arrivalsLast24hBits: arrivals24, nrtCount: dts.filter((d) => d.style.includes("NRT")).length };
}
