/**
 * End-to-end delivery of a payload created on board at time t0, over the candidate routes.
 * Every term is listed so the UI can show where the time goes.
 */
import type { CatalogEntry } from "./catalog";
import { GEO_RELAYS, GEO_ALT_KM } from "./catalog";
import type { GroundStation, DataCentre } from "./stations";
import { STATIONS } from "./stations";
import type { Contact, GeoWindow } from "./passes";
import { C_KM_S, greatCircleKm, EARTH_RADIUS_KM } from "./satellites";
import { fibreDelayMs, CCSDS_FRAME_BITS } from "./link";

export interface RouteTerm {
  label: string;
  seconds: number;
  note?: string;
}

export interface RouteResult {
  id: string;
  name: string;
  available: boolean;
  why?: string;
  via: string;
  terms: RouteTerm[];
  totalS: number;
  deliveredAt: Date | null;
  /** rate used for the space segment */
  rateBps: number;
  passesUsed: number;
}

const sum = (t: RouteTerm[]) => t.reduce((a, b) => a + b.seconds, 0);

/**
 * Drain `bits` through successive contacts at `rateBps`.  `dutyS` caps transmitter time per orbital period
 * (`periodS`): once the cap is used inside a period, the rest of that period's contacts are skipped.
 * Returns the time the last bit lands, passes used, waiting and transmit time.
 */
function drain(bits: number, contacts: Contact[], t0Ms: number, rateBps: number, dutyS = Infinity, periodS = 5800): { endMs: number; passes: number; waitS: number; txS: number; dutySkippedS: number } | null {
  let remaining = Math.max(bits, CCSDS_FRAME_BITS);
  let passes = 0, waitS = 0, txS = 0, dutySkippedS = 0;
  let cursor = t0Ms;
  let periodStart = t0Ms, usedInPeriod = 0;
  for (const c of contacts) {
    let aos = Math.max(c.aos.getTime(), cursor);
    const los = c.los.getTime();
    if (los <= cursor) continue;
    // duty-cycle bookkeeping per orbital period
    while (aos - periodStart >= periodS * 1000) { periodStart += periodS * 1000; usedInPeriod = 0; }
    const allowedS = Math.max(0, dutyS - usedInPeriod);
    if (allowedS <= 0) {
      // transmitter exhausted for this orbit: wait for the next period boundary
      const nextPeriod = periodStart + periodS * 1000;
      if (nextPeriod >= los) { dutySkippedS += (los - aos) / 1000; continue; }
      dutySkippedS += (nextPeriod - aos) / 1000;
      aos = nextPeriod; periodStart = nextPeriod; usedInPeriod = 0;
    }
    const usableS = Math.min((los - aos) / 1000, Math.max(0, dutyS - usedInPeriod));
    passes++;
    waitS += (aos - cursor) / 1000;
    const capBits = usableS * rateBps;
    if (capBits >= remaining) {
      const tx = remaining / rateBps;
      txS += tx;
      return { endMs: aos + tx * 1000, passes, waitS, txS, dutySkippedS };
    }
    remaining -= capBits;
    txS += usableS; usedInPeriod += usableS;
    cursor = aos + usableS * 1000;
  }
  return null;
}

export function computeRoutes(opts: {
  t0: Date;
  bits: number;
  entry: CatalogEntry;
  contacts: Contact[]; // over the station network (observerId = station id) and the data centre (observerId = "dc")
  geoWindows: GeoWindow[];
  stations: GroundStation[];
  dataCentre: DataCentre;
  propDelayMsNow: number | null; // when currently in contact with the chosen station
  rateOverrideBps?: number;
  processingS: number;
  /** bits already queued in the recorder ahead of this payload (FIFO); 0 when the payload has priority */
  backlogBits: number;
  /** transmitter duty-cycle cap, seconds per orbit (Infinity = none) */
  dutyS: number;
  periodS: number;
  /** stations able to receive the S-band TT&C channel, for the low-rate route */
  sbandStations: GroundStation[];
}): RouteResult[] {
  const { t0, bits, entry, contacts, geoWindows, stations, dataCentre, processingS, backlogBits, dutyS, periodS, sbandStations } = opts;
  const t0Ms = t0.getTime();
  const out: RouteResult[] = [];
  const rate = opts.rateOverrideBps ?? entry.downlink.rateMbps * 1e6;

  // ---- Route 1: direct X-band to the nearest station of the chosen network, then fibre to the data centre
  {
    const stationIds = new Set(stations.map((s) => s.id));
    const netContacts = contacts.filter((c) => stationIds.has(c.observerId));
    const d = drain(bits + backlogBits, netContacts, t0Ms, rate, dutyS, periodS);
    if (d) {
      // the station that finishes the transfer
      const last = netContacts.filter((c) => c.aos.getTime() <= d.endMs && c.los.getTime() >= d.endMs - 1).pop() ?? netContacts[0];
      const st = stations.find((s) => s.id === last.observerId)!;
      const slant = last.minRangeKm;
      const fibreKm = greatCircleKm(st, dataCentre);
      const backlogS = Math.min(d.txS, backlogBits / rate);
      const terms: RouteTerm[] = [
        { label: "wait for a pass over the network", seconds: d.waitS - d.dutySkippedS, note: d.passes > 1 ? `${d.passes} passes needed` : `next: ${st.name}` },
        ...(d.dutySkippedS > 0 ? [{ label: "passes skipped: transmitter duty-cycle cap", seconds: d.dutySkippedS, note: `${(dutyS / 60).toFixed(0)} min per orbit` }] : []),
        { label: "radio propagation (slant range)", seconds: slant / C_KM_S, note: `${slant.toFixed(0)} km at closest approach` },
        { label: "recorder backlog drained ahead of the payload (FIFO)", seconds: backlogS, note: backlogBits > 0 ? `${(backlogBits / 8e9).toFixed(1)} GB queued` : "nothing ahead of it (recorder empty or priority)" },
        { label: `serialisation at ${(rate / 1e6).toFixed(0)} Mbit/s`, seconds: d.txS - backlogS, note: bits < CCSDS_FRAME_BITS ? "one CCSDS frame minimum (1,115 B)" : undefined },
        { label: `fibre ${st.name} → ${dataCentre.name}`, seconds: fibreDelayMs(fibreKm) / 1000, note: `${fibreKm.toFixed(0)} km great circle × 1.5` },
        { label: "ground processing / forwarding", seconds: processingS },
      ];
      out.push({ id: "direct", name: "Direct downlink to the station network", available: true, via: st.name, terms, totalS: sum(terms), deliveredAt: new Date(t0Ms + sum(terms) * 1000), rateBps: rate, passesUsed: d.passes });
    } else {
      out.push({ id: "direct", name: "Direct downlink to the station network", available: false, why: "no contact with the chosen stations inside the 24 h prediction", via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: rate, passesUsed: 0 });
    }
  }

  // ---- Route 2: GEO data relay (only if the satellite carries a relay terminal)
  if (entry.relay) {
    const relays = GEO_RELAYS.filter((r) => r.system === entry.relay!.system);
    const win = geoWindows.filter((w) => relays.some((r) => r.name === w.relayName) && w.end.getTime() > t0Ms).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
    if (win) {
      const relay = relays.find((r) => r.name === win.relayName)!;
      const gw = STATIONS.find((s) => relay.gateways.includes(s.name.split(" (")[0])) ?? STATIONS.find((s) => s.id === "harwell")!;
      const rRate = entry.relay.rateMbps * 1e6;
      const waitS = Math.max(0, (win.start.getTime() - t0Ms) / 1000);
      const leoGeoKm = GEO_ALT_KM + 2000; // typical LEO→GEO distance (35,786 km + up to ~6,000 km); 37,800 km shown
      const geoGwKm = Math.sqrt((EARTH_RADIUS_KM + GEO_ALT_KM) ** 2 + EARTH_RADIUS_KM ** 2 - 2 * (EARTH_RADIUS_KM + GEO_ALT_KM) * EARTH_RADIUS_KM * Math.cos(greatCircleKm({ latDeg: 0, lonDeg: relay.lonDeg }, gw) / EARTH_RADIUS_KM));
      const fibreKm = greatCircleKm(gw, dataCentre);
      const terms: RouteTerm[] = [
        { label: `wait for line of sight to ${relay.name}`, seconds: waitS, note: waitS === 0 ? "in view now" : undefined },
        { label: "LEO → GEO propagation", seconds: leoGeoKm / C_KM_S, note: `~${leoGeoKm.toFixed(0)} km` },
        { label: "GEO → gateway propagation", seconds: geoGwKm / C_KM_S, note: `${geoGwKm.toFixed(0)} km to ${gw.name}` },
        { label: `serialisation at ${(rRate / 1e6).toFixed(0)} Mbit/s`, seconds: Math.max(bits, CCSDS_FRAME_BITS) / rRate },
        { label: `fibre ${gw.name} → ${dataCentre.name}`, seconds: fibreDelayMs(fibreKm) / 1000, note: `${fibreKm.toFixed(0)} km` },
        { label: "ground processing / forwarding", seconds: processingS },
      ];
      out.push({ id: "relay", name: `GEO relay (${entry.relay.system})`, available: true, via: `${relay.name} → ${gw.name}`, terms, totalS: sum(terms), deliveredAt: new Date(t0Ms + sum(terms) * 1000), rateBps: rRate, passesUsed: 0 });
    } else {
      out.push({ id: "relay", name: `GEO relay (${entry.relay.system})`, available: false, why: "relay not in view within 24 h", via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: 0, passesUsed: 0 });
    }
  } else {
    out.push({ id: "relay", name: "GEO relay", available: false, why: `${entry.family} has no relay terminal`, via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: 0, passesUsed: 0 });
  }

  // ---- Route 3: a receiving antenna at the data centre itself (hypothetical, same radio)
  {
    const dcContacts = contacts.filter((c) => c.observerId === "dc");
    const d = drain(bits + backlogBits, dcContacts, t0Ms, rate, dutyS, periodS);
    if (d) {
      const last = dcContacts[0];
      const backlogS = Math.min(d.txS, backlogBits / rate);
      const terms: RouteTerm[] = [
        { label: `wait for a pass over ${dataCentre.name}`, seconds: d.waitS, note: d.passes > 1 ? `${d.passes} passes` : undefined },
        { label: "radio propagation", seconds: last.minRangeKm / C_KM_S, note: `${last.minRangeKm.toFixed(0)} km` },
        { label: "recorder backlog drained ahead of the payload (FIFO)", seconds: backlogS, note: backlogBits > 0 ? `${(backlogBits / 8e9).toFixed(1)} GB queued` : "nothing ahead of it" },
        { label: `serialisation at ${(rate / 1e6).toFixed(0)} Mbit/s`, seconds: d.txS - backlogS },
        { label: "ground processing / forwarding", seconds: processingS },
      ];
      out.push({ id: "own", name: "Own antenna at the data centre (hypothetical)", available: true, via: dataCentre.name, terms, totalS: sum(terms), deliveredAt: new Date(t0Ms + sum(terms) * 1000), rateBps: rate, passesUsed: d.passes });
    } else {
      out.push({ id: "own", name: "Own antenna at the data centre (hypothetical)", available: false, why: "the satellite does not pass over the data centre within 24 h", via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: rate, passesUsed: 0 });
    }
  }
  // ---- Route 4: the S-band TT&C channel (always on, every S-band station, no backlog, no X-band duty cycle)
  if (entry.ttc) {
    const ids = new Set(sbandStations.map((s) => s.id));
    const ttcContacts = contacts.filter((c) => ids.has(c.observerId));
    const tRate = entry.ttc.rateMbps * 1e6;
    const d = drain(bits, ttcContacts, t0Ms, tRate);
    if (d) {
      const last = ttcContacts.filter((c) => c.aos.getTime() <= d.endMs && c.los.getTime() >= d.endMs - 1).pop() ?? ttcContacts[0];
      const st = sbandStations.find((s) => s.id === last.observerId)!;
      const fibreKm = greatCircleKm(st, dataCentre);
      const terms: RouteTerm[] = [
        { label: `wait for a pass over any ${entry.ttc.band}-band station (${sbandStations.length})`, seconds: d.waitS, note: d.passes > 1 ? `${d.passes} passes` : `next: ${st.name}` },
        { label: "radio propagation", seconds: last.minRangeKm / C_KM_S, note: `${last.minRangeKm.toFixed(0)} km` },
        { label: `serialisation at ${fmtRateShort(tRate)} (telemetry channel)`, seconds: d.txS, note: "no recorder queue, no X-band transmitter time" },
        { label: `fibre ${st.name} -> ${dataCentre.name}`, seconds: fibreDelayMs(fibreKm) / 1000, note: `${fibreKm.toFixed(0)} km` },
        { label: "ground processing / forwarding", seconds: processingS },
      ];
      out.push({ id: "ttc", name: `${entry.ttc.band}-band TT&C channel (semantic message in telemetry)`, available: true, via: st.name, terms, totalS: sum(terms), deliveredAt: new Date(t0Ms + sum(terms) * 1000), rateBps: tRate, passesUsed: d.passes });
    } else {
      out.push({ id: "ttc", name: `${entry.ttc.band}-band TT&C channel`, available: false, why: bits > 1e7 ? "payload too large for the telemetry channel within 48 h" : "no S-band contact within 48 h", via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: tRate, passesUsed: 0 });
    }
  }
  // ---- Route 5: a commercial LEO short-message relay (Iridium SBD-class modem on the satellite): always on, tiny payloads
  {
    const MAX_MSG_BYTES = 1960;             // Iridium SBD mobile-originated maximum
    const bytes = Math.ceil(bits / 8);
    const msgs = Math.ceil(bytes / MAX_MSG_BYTES);
    if (bits <= 100 * 8 * MAX_MSG_BYTES) {
      // measured delivery 5 s (70 B) to ~20 s (max-length message); successive messages ~20 s apart
      const perMsgS = 5 + 15 * Math.min(1, bytes / MAX_MSG_BYTES);
      const gw = STATIONS.find((s) => s.id === "ohio")!; // Iridium gateway: Tempe, Arizona; modelled at the nearest listed US site
      const fibreKm = greatCircleKm({ latDeg: 33.4, lonDeg: -111.9 }, dataCentre);
      const terms: RouteTerm[] = [
        { label: "wait: none (LEO relay constellation always overhead)", seconds: 0, note: "Iridium: 66 satellites, global" },
        { label: `message delivery through the relay (${msgs} message${msgs > 1 ? "s" : ""} of <= 1,960 B)`, seconds: perMsgS + (msgs - 1) * 20, note: "measured SBD latency 5-20 s per message" },
        { label: `fibre Iridium gateway (Tempe, AZ) -> ${dataCentre.name}`, seconds: fibreDelayMs(fibreKm) / 1000, note: `${fibreKm.toFixed(0)} km` },
        { label: "ground processing / forwarding", seconds: processingS },
      ];
      void gw;
      out.push({ id: "sbd", name: "LEO short-message relay (Iridium SBD-class modem, hypothetical fit)", available: true, via: "Iridium constellation -> Tempe gateway", terms, totalS: sum(terms), deliveredAt: new Date(t0Ms + sum(terms) * 1000), rateBps: (MAX_MSG_BYTES * 8) / 20, passesUsed: 0 });
    } else {
      out.push({ id: "sbd", name: "LEO short-message relay (Iridium SBD-class)", available: false, why: "payload too large for a short-message service (> 100 messages)", via: "—", terms: [], totalS: Infinity, deliveredAt: null, rateBps: 0, passesUsed: 0 });
    }
  }
  return out;
}

function fmtRateShort(bps: number): string {
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} Mbit/s` : `${(bps / 1e3).toFixed(0)} kbit/s`;
}
