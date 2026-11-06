"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SatData, SatState, SimClock, lookAnglesFor, parseTle, propagateGeodetic, satDetails, greatCircleKm, type Look,
} from "@/lib/satellites";
import { catalogFor, GEO_RELAYS, type CatalogEntry } from "@/lib/catalog";
import { STATIONS, DATA_CENTRES, TARGETS, type GroundStation, type DataCentre } from "@/lib/stations";
import { computeLink, payloadTiming, PAYLOADS, fmtS, fmtBits, fmtRate, type LinkBudget } from "@/lib/link";
import { predictContacts, minElForOffNadir, geoVisible, type Contact, type GeoWindow } from "@/lib/passes";
import { computeRoutes, type RouteResult } from "@/lib/routes";
import type { RouteView } from "./Scene";
import { estimateQueue, S2_CORE_STATION_IDS, type Datatake, type QueueEstimate } from "@/lib/queue";
import * as satellite from "satellite.js";

const Scene = dynamic(() => import("./Scene"), { ssr: false });
const SPEEDS = [10, 60, 600, 3600];
const NETWORKS = ["all", "KSAT", "ESA", "NASA", "AWS", "USGS", "Copernicus", "other"] as const;

function Btn({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button title={title} onClick={onClick} className={`border px-2 py-0.5 uppercase tracking-wider transition-colors ${active ? "border-green-400 bg-green-500/20 text-green-200" : "border-green-500/30 bg-black/50 text-green-500 hover:border-green-400/60 hover:text-green-300"}`}>
      {children}
    </button>
  );
}
function Row({ k, v, dim }: { k: string; v: React.ReactNode; dim?: boolean }) {
  return (<div className={`flex justify-between gap-2 ${dim ? "text-green-700" : ""}`}><span className="text-green-500/80">{k}</span><span className="text-right text-green-200">{v}</span></div>);
}
const fmtT = (d: Date) => d.toISOString().replace("T", " ").slice(5, 19);
const num = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");

export default function App() {
  const [sats, setSats] = useState<SatData[] | null>(null);
  const [source, setSource] = useState<"live" | "fallback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(true);
  const [speed, setSpeed] = useState(60);
  const [paused, setPaused] = useState(false);
  const [timeStr, setTimeStr] = useState("");
  const [showLabels, setShowLabels] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]>("all");
  const [dcId, setDcId] = useState("glasgow");
  const [custom, setCustom] = useState<DataCentre | null>(null);
  const [targetId, setTargetId] = useState("none");
  const [customTarget, setCustomTarget] = useState<{ latDeg: number; lonDeg: number } | null>(null);
  const [minEl, setMinEl] = useState(5);
  const [offNadir, setOffNadir] = useState(30);
  const [rain, setRain] = useState(0);
  const [dish, setDish] = useState<number | null>(null);
  const [tsys, setTsys] = useState(150);
  const [payloadId, setPayloadId] = useState("frog_frame");
  const [customBits, setCustomBits] = useState("");
  const [processingS, setProcessingS] = useState(0);
  const [selInfo, setSelInfo] = useState<SatState | null>(null);
  const [lookDc, setLookDc] = useState<Look | null>(null);
  const [inView, setInView] = useState<{ st: GroundStation; look: Look }[]>([]);
  const [pred, setPred] = useState<{ contacts: Contact[]; geoWindows: GeoWindow[]; at: number } | null>(null);
  const [tab, setTab] = useState<"link" | "passes" | "delivery" | "sat">("delivery");
  const [geoNow, setGeoNow] = useState<{ name: string; lon: number } | null>(null);

  const clockRef = useRef<SimClock>({ simMs: Date.now(), speed: 1, paused: false, live: true });
  const snapshotRef = useRef<(() => string | null) | null>(null);
  const routeRef = useRef<RouteView>({ stationId: null, inViewIds: [], relayLonDeg: null, relayVisible: false, fibreFrom: null });

  /* ---------------- data ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let text: string | null = null; let src: "live" | "fallback" = "live";
      try { const r = await fetch("/api/tles"); if (r.ok) text = await r.text(); } catch {}
      if (!text) {
        src = "fallback";
        try {
          const [a, b] = await Promise.all([fetch("/eo-fallback.txt"), fetch("/eo-extra.txt")]);
          text = (a.ok ? await a.text() : "") + "\n" + (b.ok ? await b.text() : "");
        } catch {}
      }
      if (cancelled) return;
      if (!text) { setError("COULD NOT LOAD TLE DATA"); return; }
      const parsed = parseTle(text).sort((a, b) => a.name.localeCompare(b.name));
      if (!parsed.length) { setError("TLE DATA EMPTY"); return; }
      setSats(parsed); setSource(src);
      const s2 = parsed.findIndex((s) => s.name.startsWith("SENTINEL-2A"));
      setSelected(s2 >= 0 ? s2 : 0);
    })();
    return () => { cancelled = true; };
  }, []);

  const dataCentre: DataCentre = useMemo(() => custom ?? DATA_CENTRES.find((d) => d.id === dcId)!, [custom, dcId]);
  const target = useMemo(() => {
    if (customTarget) return { ...customTarget, name: `${customTarget.latDeg.toFixed(2)}, ${customTarget.lonDeg.toFixed(2)}` };
    const t = TARGETS.find((t) => t.id === targetId);
    return t && t.id !== "none" ? t : null;
  }, [targetId, customTarget]);
  const details = useMemo(() => (selected != null && sats ? satDetails(sats[selected]) : null), [sats, selected]);
  const entry: CatalogEntry | null = useMemo(() => (sats && selected != null ? catalogFor(sats[selected].name) : null), [sats, selected]);
  const stationsAll = useMemo(() => STATIONS.filter((s) => {
    if (network === "all") return true;
    if (network === "other") return !["KSAT", "ESA", "NASA", "AWS", "USGS", "Copernicus"].some((n) => s.network.includes(n));
    return s.network.includes(network);
  }), [network]);
  const stations = useMemo(() => stationsAll.filter((s) => s.bands.includes(entry?.downlink.band ?? "X")), [stationsAll, entry]);
  const sbandStations = useMemo(() => stationsAll.filter((s) => s.bands.includes(entry?.ttc?.band ?? "S")), [stationsAll, entry]);
  const [backlogGB, setBacklogGB] = useState<string>("");
  const [priority, setPriority] = useState(false);
  const [dutyOn, setDutyOn] = useState(true);
  const defaultBacklogGB = entry ? (entry.dailyVolumeGB ?? 500) / 16 : 0; // ~1.5 h of acquisition since the last playback
  const backlogBits = priority ? 0 : (Number.isFinite(parseFloat(backlogGB)) ? parseFloat(backlogGB) : defaultBacklogGB) * 8e9;
  const dutyS = dutyOn && entry ? (entry.xbandDutyMinPerOrbit ?? 30) * 60 : Infinity;
  const periodS = details ? details.periodMin * 60 : 5800;

  /* ---------------- Sentinel-2 acquisition plan -> recorder queue estimate ---------------- */
  const s2 = sats && selected != null ? sats[selected].name.match(/^SENTINEL-2([ABC])/) : null;
  const [plan, setPlan] = useState<{ sat: string; source: string; file: string; datatakes: Datatake[] } | null>(null);
  const [queue, setQueue] = useState<QueueEstimate | null>(null);
  useEffect(() => {
    setPlan(null); setQueue(null);
    if (!s2) return;
    let cancelled = false;
    fetch(`/api/s2plan?sat=2${s2[1]}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (!cancelled && j && j.datatakes) setPlan(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, [s2?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!plan || !sats || selected == null || !s2) return;
    const run = () => {
      const now = new Date(clockRef.current.simMs);
      const from = now.getTime() - 24 * 3600000;
      const core = STATIONS.filter((st) => S2_CORE_STATION_IDS.includes(st.id)).map((st) => ({ id: st.id, latDeg: st.latDeg, lonDeg: st.lonDeg, altKm: st.altKm, minElDeg: 5 }));
      // contacts from 48 h ago so the 24 h warm-up before the displayed window is served realistically
      const r = predictContacts(sats[selected].satrec, new Date(from - 24 * 3600000), 72, core, GEO_RELAYS.filter((g) => g.system === "EDRS"));
      const names = Object.fromEntries(STATIONS.map((st) => [st.id, st.name.split(" (")[0]]));
      setQueue(estimateQueue(plan.datatakes, r.contacts, r.geoWindows, names, now, from, now.getTime() + 24 * 3600000));
    };
    run();
    const id = setInterval(run, 60000);
    return () => clearInterval(id);
  }, [plan, sats, selected, s2?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const planBacklogGB = queue ? queue.nowBits / 8e9 : null;
  const effectiveDefaultGB = planBacklogGB ?? defaultBacklogGB;
  const backlogBitsEff = priority ? 0 : (Number.isFinite(parseFloat(backlogGB)) ? parseFloat(backlogGB) : effectiveDefaultGB) * 8e9;
  const relays = useMemo(() => (entry?.relay ? GEO_RELAYS.filter((r) => r.system === entry.relay!.system) : []), [entry]);
  const payloadBits = useMemo(() => {
    const c = parseFloat(customBits);
    if (Number.isFinite(c) && c > 0) return c;
    return PAYLOADS.find((p) => p.id === payloadId)!.bits;
  }, [payloadId, customBits]);

  /* ---------------- 4 Hz HUD ---------------- */
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date(clockRef.current.simMs);
      setTimeStr(now.toISOString().replace("T", " ").slice(0, 19) + " UTC");
      if (!sats || selected == null) return;
      const sat = sats[selected];
      setSelInfo(propagateGeodetic(sat.satrec, now));
      setLookDc(lookAnglesFor(sat.satrec, now, dataCentre));
      const vis: { st: GroundStation; look: Look }[] = [];
      for (const st of stations) {
        const l = lookAnglesFor(sat.satrec, now, st);
        if (l && l.elDeg >= minEl) vis.push({ st, look: l });
      }
      vis.sort((a, b) => b.look.elDeg - a.look.elDeg);
      setInView(vis);
      // GEO relay visibility now
      let g: { name: string; lon: number } | null = null;
      if (relays.length) {
        const pv = satellite.propagate(sat.satrec, now);
        if (pv && pv.position && typeof pv.position !== "boolean") {
          const ecf = satellite.eciToEcf(pv.position, satellite.gstime(now));
          const r = relays.find((r) => geoVisible(ecf, r.lonDeg));
          if (r) g = { name: r.name, lon: r.lonDeg };
        }
      }
      setGeoNow(g);
      routeRef.current = {
        stationId: vis[0]?.st.id ?? routeRef.current.stationId,
        inViewIds: vis.map((v) => v.st.id),
        relayLonDeg: g?.lon ?? relays[0]?.lonDeg ?? null,
        relayVisible: !!g,
        fibreFrom: routeRef.current.fibreFrom,
      };
    }, 250);
    return () => clearInterval(id);
  }, [sats, selected, dataCentre, stations, minEl, relays]);

  /* ---------------- 24 h prediction (recomputed when inputs change or sim time jumps > 10 min) ---------------- */
  const predKey = `${selected}|${stationsAll.map((s) => s.id).join(",")}|${dataCentre.latDeg},${dataCentre.lonDeg}|${target?.latDeg},${target?.lonDeg}|${minEl}|${offNadir}`;
  useEffect(() => {
    if (!sats || selected == null || !entry) return;
    let cancelled = false;
    const run = () => {
      const start = new Date(clockRef.current.simMs);
      const obs = [
        ...stationsAll.map((s) => ({ id: s.id, latDeg: s.latDeg, lonDeg: s.lonDeg, altKm: s.altKm, minElDeg: minEl })),
        { id: "dc", latDeg: dataCentre.latDeg, lonDeg: dataCentre.lonDeg, altKm: 0, minElDeg: minEl },
        ...(target ? [{ id: "target", latDeg: target.latDeg, lonDeg: target.lonDeg, altKm: 0, minElDeg: minElForOffNadir(entry.altitudeKm, offNadir) }] : []),
      ];
      const r = predictContacts(sats[selected].satrec, start, 48, obs, relays);
      if (!cancelled) setPred({ ...r, at: start.getTime() });
    };
    run();
    const id = setInterval(() => {
      if (!pred || Math.abs(clockRef.current.simMs - pred.at) > 10 * 60000) run();
    }, 2000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [predKey, sats, entry]);

  /* ---------------- link budget now ---------------- */
  const best = inView[0] ?? null;
  const dishM = dish ?? best?.st.dishM ?? 7.3;
  const linkNow: LinkBudget | null = useMemo(() => {
    if (!entry || !best) return null;
    return computeLink({ spec: entry.downlink, rangeKm: best.look.rangeKm, elDeg: best.look.elDeg, rangeRateKmS: best.look.rangeRateKmS, dishM, tSysK: tsys, antennaEffiency: 0.6, rainRateMmH: rain });
  }, [entry, best, dishM, tsys, rain]);
  // a reference budget at the pass's best geometry (max elevation of the next contact) when nothing is in view
  const nextContact = useMemo(() => {
    if (!pred) return null;
    const ids = new Set(stations.map((s) => s.id));
    const now = clockRef.current.simMs;
    return pred.contacts.filter((c) => ids.has(c.observerId) && c.los.getTime() > now).sort((a, b) => a.aos.getTime() - b.aos.getTime())[0] ?? null;
  }, [pred, stations, timeStr]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkRef: LinkBudget | null = useMemo(() => {
    if (!entry || !nextContact) return null;
    const st = stations.find((s) => s.id === nextContact.observerId)!;
    return computeLink({ spec: entry.downlink, rangeKm: nextContact.minRangeKm, elDeg: nextContact.maxElDeg, rangeRateKmS: 0, dishM: dish ?? st.dishM, tSysK: tsys, antennaEffiency: 0.6, rainRateMmH: rain });
  }, [entry, nextContact, stations, dish, tsys, rain]);
  const lb = linkNow ?? linkRef;
  const timing = lb ? payloadTiming(payloadBits, lb) : null;

  /* ---------------- delivery routes ---------------- */
  const t0 = useMemo(() => {
    const now = clockRef.current.simMs;
    if (target && pred) {
      const tp = pred.contacts.filter((c) => c.observerId === "target" && c.los.getTime() > now)[0];
      if (tp) return { at: new Date(Math.max(tp.aos.getTime(), now)), why: `next time ${sats![selected!].name} can image the target (off-nadir ≤ ${offNadir}°)`, target: tp };
      return { at: new Date(now), why: "target not reachable within 48 h; message assumed created now", target: null };
    }
    return { at: new Date(now), why: "message created on board now", target: null };
  }, [target, pred, timeStr]); // eslint-disable-line react-hooks/exhaustive-deps
  const routes: RouteResult[] = useMemo(() => {
    if (!entry || !pred) return [];
    return computeRoutes({ t0: t0.at, bits: payloadBits, entry, contacts: pred.contacts, geoWindows: pred.geoWindows, stations, dataCentre, propDelayMsNow: null, processingS, backlogBits: backlogBitsEff, dutyS, periodS, sbandStations });
  }, [entry, pred, t0, payloadBits, stations, dataCentre, processingS, backlogBitsEff, dutyS, periodS, sbandStations]);
  const comparison = useMemo(() => {
    if (!entry || !pred) return [];
    return PAYLOADS.map((p) => {
      const rs = computeRoutes({ t0: t0.at, bits: p.bits, entry, contacts: pred.contacts, geoWindows: pred.geoWindows, stations, dataCentre, propDelayMsNow: null, processingS, backlogBits: backlogBitsEff, dutyS, periodS, sbandStations });
      return { p, direct: rs.find((r) => r.id === "direct")!, relay: rs.find((r) => r.id === "relay")!, own: rs.find((r) => r.id === "own")!, ttc: rs.find((r) => r.id === "ttc") ?? null, sbd: rs.find((r) => r.id === "sbd") ?? null };
    });
  }, [entry, pred, t0, stations, dataCentre, processingS, backlogBitsEff, dutyS, periodS, sbandStations]);
  useEffect(() => {
    const direct = routes.find((r) => r.id === "direct");
    const st = direct?.available ? stations.find((s) => s.name === direct.via) : null;
    routeRef.current.fibreFrom = st ?? null;
    if (st) routeRef.current.stationId = st.id;
  }, [routes, stations]);

  /* ---------------- controls ---------------- */
  const setSpeedTo = (s: number) => { clockRef.current.speed = s; clockRef.current.paused = false; clockRef.current.live = false; setSpeed(s); setPaused(false); setLive(false); };
  const togglePause = () => { clockRef.current.paused = !clockRef.current.paused; clockRef.current.live = false; setPaused(clockRef.current.paused); setLive(false); };
  const goLive = () => { clockRef.current.simMs = Date.now(); clockRef.current.speed = 1; clockRef.current.paused = false; clockRef.current.live = true; setPaused(false); setLive(true); };
  const jumpTo = (d: Date) => { clockRef.current.simMs = d.getTime() - 30000; clockRef.current.paused = false; clockRef.current.live = false; clockRef.current.speed = 10; setSpeed(10); setPaused(false); setLive(false); };
  const onPickGround = useCallback((lat: number, lon: number, kind: "dc" | "target") => {
    if (kind === "dc") setCustom({ id: "custom", name: `custom ${lat.toFixed(2)}, ${lon.toFixed(2)}`, latDeg: lat, lonDeg: lon, note: "picked on the globe" });
    else setCustomTarget({ latDeg: lat, lonDeg: lon });
  }, []);

  const [pdfBusy, setPdfBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const [showResults, setShowResults] = useState(true);
  const [wide, setWide] = useState(false);
  const downloadPdf = useCallback(async () => {
    if (!sats || selected == null || !entry || !details) return;
    setPdfBusy(true);
    try {
      const { buildReport } = await import("@/lib/report");
      let globePng: string | null = null;
      try { globePng = snapshotRef.current ? snapshotRef.current() : null; } catch {}
      const preset = PAYLOADS.find((p) => p.id === payloadId)!;
      const lbStation = linkNow ? best!.st : nextContact ? stations.find((s) => s.id === nextContact.observerId) ?? null : null;
      const lbLook = linkNow && best ? { rangeKm: best.look.rangeKm, elDeg: best.look.elDeg, rangeRateKmS: best.look.rangeRateKmS } : nextContact ? { rangeKm: nextContact.minRangeKm, elDeg: nextContact.maxElDeg, rangeRateKmS: 0 } : null;
      const doc = buildReport({
        sat: sats[selected], entry, details, state: selInfo, simTime: new Date(clockRef.current.simMs), dataCentre, target, offNadirDeg: offNadir,
        stations, networkName: network, minElDeg: minEl, dishM, tSysK: tsys, rainMmH: rain,
        payloadName: customBits ? `custom ${customBits} bit` : preset.name, payloadBits, payloadSource: customBits ? "user input" : preset.source,
        lb, lbIsNow: !!linkNow, lbStation, lbLook, timing, routes, t0: { at: t0.at, why: t0.why },
        comparison: comparison.map((c) => ({ name: c.p.name, bits: c.p.bits, direct: c.direct, relay: c.relay, own: c.own, ttc: c.ttc, sbd: c.sbd })),
        backlogGB: backlogBitsEff / 8e9, priority,
        queueNote: queue && plan ? `Recorder queue estimated from the ESA Sentinel-2 acquisition plan (${plan.source === "esa-live" ? "live file" : "bundled snapshot"} ${plan.file.split("/").pop()}): ${(queue.nowBits / 8e9).toFixed(1)} GB now; ${(queue.arrivalsLast24hBits / 8e9).toFixed(0)} GB acquired in the last 24 h at 490 Mbit/s compressed; peak in the last 24 h ${(Math.max(0, ...queue.series.filter((q) => q.t <= clockRef.current.simMs).map((q) => q.bits)) / 8e9).toFixed(0)} GB; recorder next empty ${queue.drainsAt ? `at ${queue.drainsAt.toISOString().slice(11, 16)} UTC${queue.drainVia ? ` via ${queue.drainVia}` : ""}` : "not within 24 h"}; last datatake ${queue.lastDatatake ? `${queue.lastDatatake.start.slice(11, 16)} UTC, ${(queue.lastDatatake.durS / 60).toFixed(1)} min, ${queue.lastDatatake.scenes} scenes` : "-"}; next ${queue.nextDatatake ? `${queue.nextDatatake.start.slice(11, 16)} UTC` : "-"}. Service model: 560 Mbit/s X-band over Matera, Maspalomas, Svalbard, Inuvik; EDRS 1.8 Gbit/s up to 25 min per orbit while in line of sight; 2.4 Tbit memory.` : null, dutyMin: dutyOn ? (entry.xbandDutyMinPerOrbit ?? 30) : null, dailyVolume: `${entry.dailyVolumeGB} GB/day (${entry.dailyVolumeSource})`, sbandStationCount: sbandStations.length,
        contacts: pred?.contacts ?? [], geoWindows: pred?.geoWindows ?? [], inView, relayNow: geoNow ? `${geoNow.name} in line of sight` : null, globePng,
      });
      const stamp = new Date(clockRef.current.simMs).toISOString().slice(0, 16).replace(/[:T]/g, "-");
      doc.save(`eo_link_report_${sats[selected].name.replace(/[^A-Za-z0-9]+/g, "_")}_${dataCentre.name.replace(/[^A-Za-z0-9]+/g, "_")}_${stamp}.pdf`);
    } finally { setPdfBusy(false); }
  }, [sats, selected, entry, details, selInfo, dataCentre, target, offNadir, stations, network, minEl, dishM, tsys, rain, payloadId, customBits, payloadBits, lb, linkNow, best, nextContact, timing, routes, t0, comparison, pred, inView, geoNow, backlogBitsEff, priority, dutyOn, sbandStations, queue, plan]);

  const filtered = useMemo(() => {
    if (!sats) return [];
    const q = query.trim().toUpperCase();
    return sats.map((s, i) => ({ name: s.name, i, fam: catalogFor(s.name).family })).filter((s) => !q || s.name.toUpperCase().includes(q) || s.fam.toUpperCase().includes(q));
  }, [sats, query]);
  const contactsNet = useMemo(() => {
    if (!pred) return [];
    const ids = new Set(stations.map((s) => s.id));
    return pred.contacts.filter((c) => ids.has(c.observerId));
  }, [pred, stations]);
  const dcDistKm = best ? greatCircleKm(best.st, dataCentre) : null;

  return (
    <div className="relative h-dvh w-full select-none overflow-hidden bg-black font-mono text-[12px] text-green-400">
      {sats && (
        <Scene sats={sats} clockRef={clockRef} routeRef={routeRef} snapshotRef={snapshotRef} selected={selected} onSelect={setSelected} onPickGround={onPickGround}
          stations={stations} dataCentre={dataCentre} target={target} minElDeg={minEl} showLabels={showLabels} showAllSats={showAll} relays={relays} />
      )}

      {/* Header */}
      <div className="pointer-events-none absolute left-4 top-3 space-y-0.5">
        <h1 className="text-base tracking-[0.3em] text-green-300">EARTH-OBSERVATION LINK SIMULATOR</h1>
        <p className="text-green-500/80">
          {sats ? `${sats.length} EO SATELLITES` : "ACQUIRING TLE DATA…"}
          {source === "live" && " • LIVE TLE (CELESTRAK)"}{source === "fallback" && " • CACHED TLE SNAPSHOT"}
        </p>
        <p className="text-[14px] text-green-200">{timeStr}</p>
        {live ? <p className="text-green-300"><span className="animate-pulse">●</span> LIVE — REAL-TIME POSITIONS (SGP4)</p>
          : <p className="text-amber-400/90">{paused ? "SIMULATION PAUSED" : `SIMULATION ×${speed}`} — NOT REAL TIME</p>}
        <p className="text-green-700">shift-click globe = data centre • alt-click = target • click = satellite</p>
      </div>
      {error && <div className="absolute inset-0 flex items-center justify-center"><p className="border border-red-500/50 bg-black/80 px-6 py-4 text-red-400">{error}</p></div>}

      {/* Left: satellite list + card */}
      <div className="absolute bottom-4 left-4 top-28 flex w-72 flex-col gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH SATELLITE / FAMILY…" className="border border-green-500/30 bg-black/60 px-2 py-1 text-green-300 placeholder-green-800 outline-none focus:border-green-400/60" />
        <div className="h-44 overflow-y-auto border border-green-500/30 bg-black/60">
          {filtered.map(({ name, i, fam }) => (
            <button key={i} onClick={() => setSelected(i)} className={`block w-full px-2 py-0.5 text-left transition-colors ${selected === i ? "bg-green-500/25 text-green-100" : "text-green-500 hover:bg-green-500/10 hover:text-green-300"}`}>
              {name}<span className="float-right text-green-800">{fam.split(" (")[0].slice(0, 14)}</span>
            </button>
          ))}
        </div>
        {selected != null && sats && entry && (
          <div className="flex-1 space-y-1 overflow-y-auto border border-green-500/30 bg-black/70 p-2">
            <p className="text-[13px] text-green-100">{sats[selected].name}</p>
            <p className="text-green-500/80">{entry.family} • {entry.operator}</p>
            <p className="text-green-500/80">{entry.sensor}; {entry.resolution}{entry.swathKm ? `; swath ${entry.swathKm} km` : ""}</p>
            {selInfo && (<>
              <Row k="LAT / LON" v={`${selInfo.latDeg.toFixed(2)}° / ${selInfo.lonDeg.toFixed(2)}°`} />
              <Row k="ALT / SPEED" v={`${selInfo.altKm.toFixed(0)} km / ${selInfo.speedKmS.toFixed(2)} km/s`} />
            </>)}
            {details && (<>
              <Row k="NORAD / COSPAR" v={`${details.noradId} / ${details.cospar}`} />
              <Row k="INCL / PERIOD" v={`${details.inclinationDeg.toFixed(2)}° / ${details.periodMin.toFixed(1)} min`} />
              <Row k="PERIGEE / APOGEE" v={`${details.perigeeKm.toFixed(0)} / ${details.apogeeKm.toFixed(0)} km`} />
              <Row k="TLE EPOCH" v={`${fmtT(details.epoch)} (${((Date.now() - details.epoch.getTime()) / 3600000).toFixed(1)} h)`} />
            </>)}
            <p className="pt-1 text-green-200">PAYLOAD DOWNLINK <span className={`ml-1 text-[10px] ${entry.confidence === "sourced" ? "text-green-400" : entry.confidence === "typical" ? "text-amber-300" : "text-red-300"}`}>[{entry.confidence.toUpperCase()}]</span></p>
            <Row k="BAND / FREQ" v={`${entry.downlink.band}-band ${entry.downlink.freqMHz >= 1000 ? (entry.downlink.freqMHz / 1000).toFixed(3) + " GHz" : entry.downlink.freqMHz + " MHz"}`} />
            <Row k="RATE" v={fmtRate(entry.downlink.rateMbps * 1e6)} />
            <Row k="MOD / CODE" v={`${entry.downlink.modulation}, r=${entry.downlink.codeRate.toFixed(2)}`} />
            <Row k="EIRP" v={`${entry.downlink.eirpdBW} dBW${entry.downlink.eirpAssumed ? " (assumed)" : ""}`} />
            {entry.ttc && <Row k="TT&C" v={`${entry.ttc.band}-band ${fmtRate(entry.ttc.rateMbps * 1e6)}`} />}
            {entry.directBroadcast && <Row k="DIRECT BCAST" v={`${entry.directBroadcast.freqMHz} MHz, ${entry.directBroadcast.rateMbps} Mbit/s`} />}
            {entry.relay && <Row k="RELAY" v={`${entry.relay.system} ${fmtRate(entry.relay.rateMbps * 1e6)}`} />}
            {entry.notes && <p className="text-green-600">{entry.notes}</p>}
            <p className="pt-1 text-green-700">SOURCES</p>
            {entry.sources.map((s, i) => <p key={i} className="text-green-700">• {s}</p>)}
            <a href={`https://www.n2yo.com/satellite/?s=${details?.noradId}`} target="_blank" rel="noopener noreferrer" className="block text-cyan-400 underline">VERIFY ON N2YO ↗</a>
          </div>
        )}
      </div>

      {/* Bottom-left: time */}
      <div className="absolute bottom-4 left-80 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-green-500/70">TIME</span>
        <Btn active={live} onClick={goLive}>● live</Btn>
        <Btn onClick={togglePause}>{paused ? "run" : "pause"}</Btn>
        {SPEEDS.map((s) => <Btn key={s} active={!live && !paused && speed === s} onClick={() => setSpeedTo(s)}>{s}×</Btn>)}
        {nextContact && <Btn onClick={() => jumpTo(nextContact.aos)} title="set the clock 30 s before the next contact">jump to next pass</Btn>}
        <span className="mx-1 text-green-500/70">|</span>
        <Btn active={showAll} onClick={() => setShowAll((v) => !v)}>all sats</Btn>
        <Btn active={showLabels} onClick={() => setShowLabels((v) => !v)}>labels</Btn>
      </div>

      {/* Right: destination + numbers */}
      <div className={`absolute bottom-4 right-4 top-3 flex flex-col gap-2 ${wide ? "w-[44rem] max-w-[70vw]" : "w-[27rem] max-w-[45vw]"}`}>
        <div className="space-y-1 border border-pink-500/40 bg-black/70 p-2 text-pink-200">
          <div className="flex items-center justify-between">
            <p className="text-pink-300">{showSettings ? "WHERE THE DATA MUST ARRIVE (DATA CENTRE)" : `${dataCentre.name} · ${customBits ? customBits + " bit" : PAYLOADS.find((p) => p.id === payloadId)?.name.split(",")[0]} · ${network} stations${target ? ` · target ${target.name.split(" (")[0]}` : ""}`}</p>
            <button onClick={() => setShowSettings((v) => !v)} className="border border-pink-500/40 px-2 py-0.5 uppercase tracking-wider text-pink-200 hover:bg-pink-500/20" title="show or hide the settings panel">{showSettings ? "hide settings" : "show settings"}</button>
          </div>
          {showSettings && (<>
          <div className="flex gap-1">
            <select value={custom ? "custom" : dcId} onChange={(e) => { if (e.target.value !== "custom") { setCustom(null); setDcId(e.target.value); } }} className="min-w-0 flex-1 border border-pink-500/30 bg-black/60 px-1 text-pink-200 outline-none">
              {DATA_CENTRES.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              {custom && <option value="custom">{custom.name}</option>}
            </select>
          </div>
          <div className="flex items-center gap-1 text-pink-300/80">
            <span>LAT</span><input value={dataCentre.latDeg.toFixed(3)} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setCustom({ id: "custom", name: "custom", latDeg: v, lonDeg: dataCentre.lonDeg, note: "" }); }} className="w-20 border border-pink-500/30 bg-black/60 px-1 text-pink-100 outline-none" />
            <span>LON</span><input value={dataCentre.lonDeg.toFixed(3)} onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setCustom({ id: "custom", name: "custom", latDeg: dataCentre.latDeg, lonDeg: v, note: "" }); }} className="w-20 border border-pink-500/30 bg-black/60 px-1 text-pink-100 outline-none" />
            {lookDc && <span className="ml-auto text-pink-300/70">sat: EL {lookDc.elDeg.toFixed(0)}° RNG {lookDc.rangeKm.toFixed(0)} km</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1 text-orange-300/90">
            <span>TARGET</span>
            <select value={customTarget ? "custom" : targetId} onChange={(e) => { if (e.target.value !== "custom") { setCustomTarget(null); setTargetId(e.target.value); } }} className="min-w-0 flex-1 border border-orange-500/30 bg-black/60 px-1 text-orange-200 outline-none">
              {TARGETS.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              {customTarget && <option value="custom">custom {customTarget.latDeg.toFixed(2)}, {customTarget.lonDeg.toFixed(2)}</option>}
            </select>
            <span>≤</span><input value={offNadir} onChange={(e) => setOffNadir(parseFloat(e.target.value) || 30)} className="w-10 border border-orange-500/30 bg-black/60 px-1 text-orange-100 outline-none" /><span>° off-nadir</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-cyan-300/90">
            <span>STATIONS</span>
            {NETWORKS.map((n) => <Btn key={n} active={network === n} onClick={() => setNetwork(n)}>{n}</Btn>)}
            <span className="text-cyan-600">({stations.length} with {entry?.downlink.band ?? "X"}-band)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-cyan-300/80">
            <span>MASK</span><input value={minEl} onChange={(e) => setMinEl(parseFloat(e.target.value) || 0)} className="w-10 border border-cyan-500/30 bg-black/60 px-1 text-cyan-100 outline-none" /><span>°</span>
            <span>DISH</span><input value={dish ?? ""} placeholder={`${best?.st.dishM ?? 7.3}`} onChange={(e) => { const v = parseFloat(e.target.value); setDish(Number.isFinite(v) ? v : null); }} className="w-10 border border-cyan-500/30 bg-black/60 px-1 text-cyan-100 outline-none" /><span>m</span>
            <span>Tsys</span><input value={tsys} onChange={(e) => setTsys(parseFloat(e.target.value) || 150)} className="w-12 border border-cyan-500/30 bg-black/60 px-1 text-cyan-100 outline-none" /><span>K</span>
            <span>RAIN</span><input value={rain} onChange={(e) => setRain(parseFloat(e.target.value) || 0)} className="w-10 border border-cyan-500/30 bg-black/60 px-1 text-cyan-100 outline-none" /><span>mm/h</span>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-amber-200/90">
            <span>PAYLOAD</span>
            <select value={customBits ? "custom" : payloadId} onChange={(e) => { if (e.target.value !== "custom") { setCustomBits(""); setPayloadId(e.target.value); } }} className="min-w-0 flex-1 border border-amber-500/30 bg-black/60 px-1 text-amber-100 outline-none">
              {PAYLOADS.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmtBits(p.bits)}</option>)}
              {customBits && <option value="custom">custom</option>}
            </select>
            <input value={customBits} placeholder="bits" onChange={(e) => setCustomBits(e.target.value)} className="w-16 border border-amber-500/30 bg-black/60 px-1 text-amber-100 outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-1 text-amber-200/70">
            <span>GROUND PROCESSING</span><input value={processingS} onChange={(e) => setProcessingS(parseFloat(e.target.value) || 0)} className="w-14 border border-amber-500/30 bg-black/60 px-1 text-amber-100 outline-none" /><span>s</span>
            <Btn active={processingS === 0} onClick={() => setProcessingS(0)} title="forward the message as received">raw</Btn>
            <Btn active={processingS === 3600} onClick={() => setProcessingS(3600)} title="ESA NRT product commitment (Sentinel-1 emergency: 1 h)">NRT 1 h</Btn>
            <Btn active={processingS === 86400} onClick={() => setProcessingS(86400)} title="standard product timeliness (Sentinel / Landsat: within 24 h)">std 24 h</Btn>
          </div>
          <div className="flex flex-wrap items-center gap-1 text-red-200/80">
            <span title="data already in the on-board recorder ahead of this payload; default = daily volume / 16 (about 1.5 h of acquisition)">RECORDER BACKLOG</span>
            <input value={backlogGB} placeholder={effectiveDefaultGB.toFixed(0)} onChange={(e) => setBacklogGB(e.target.value)} disabled={priority} className="w-14 border border-red-500/30 bg-black/60 px-1 text-red-100 outline-none disabled:opacity-40" /><span>GB</span>
            <Btn active={priority} onClick={() => setPriority((v) => !v)} title="the payload jumps the recorder queue (operators' priority scheme for critical data)">priority</Btn>
            <Btn active={dutyOn} onClick={() => setDutyOn((v) => !v)} title={`X-band transmitter cap ${entry?.xbandDutyMinPerOrbit ?? 30} min per orbit (power / thermal)`}>duty {entry?.xbandDutyMinPerOrbit ?? 30} min/orbit</Btn>
            <span className="w-full text-red-500/60">{entry?.dailyVolumeGB} GB/day — {entry?.dailyVolumeSource}</span>
            {s2 && (
              <div className="w-full text-red-200/80">
                {queue && plan ? (<>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-red-300">ESA PLAN:</span>
                    <span>{(queue.nowBits / 8e9).toFixed(1)} GB in the recorder now</span>
                    <span className="text-red-500/70">· {(queue.arrivalsLast24hBits / 8e9).toFixed(0)} GB acquired in 24 h · peak {(Math.max(0, ...queue.series.filter((q) => q.t <= clockRef.current.simMs).map((q) => q.bits)) / 8e9).toFixed(0)} GB · {queue.nowBits > 0 ? "empty again" : "next empty"} {queue.drainsAt ? `${queue.drainsAt.toISOString().slice(11, 16)} UTC${queue.drainVia ? ` via ${queue.drainVia}` : ""}` : "not within 24 h"}</span>
                    <Btn active={backlogGB === ""} onClick={() => setBacklogGB("")} title="use the plan estimate as the backlog">use plan</Btn>
                  </div>
                  <svg viewBox="0 0 400 40" className="mt-0.5 h-10 w-full" preserveAspectRatio="none">
                    {(() => {
                      const max = Math.max(1, ...queue.series.map((q) => q.bits));
                      const t0s = queue.series[0]?.t ?? 0, t1s = queue.series[queue.series.length - 1]?.t ?? 1;
                      const pts = queue.series.map((q) => `${((q.t - t0s) / (t1s - t0s)) * 400},${40 - (q.bits / max) * 36}`).join(" ");
                      const nowX = ((clockRef.current.simMs - t0s) / (t1s - t0s)) * 400;
                      return (<>
                        <polyline points={pts} fill="none" stroke="#ff6b6b" strokeWidth="1.2" />
                        <line x1={nowX} y1="0" x2={nowX} y2="40" stroke="#ffd166" strokeWidth="1" />
                        <text x="2" y="9" fill="#ff9a9a" fontSize="8">{(max / 8e9).toFixed(0)} GB</text>
                        <text x="2" y="38" fill="#ff9a9a" fontSize="7">−24 h</text><text x="372" y="38" fill="#ff9a9a" fontSize="7">+24 h</text>
                      </>);
                    })()}
                  </svg>
                  <span className="text-red-500/60">queue = datatakes from the plan ({plan.source === "esa-live" ? "live" : "snapshot"}, {plan.file.split("/").pop()?.slice(0, 40)}) × 490 Mbit/s, drained at 560 Mbit/s over the core stations and 1.8 Gbit/s on EDRS; last datatake {queue.lastDatatake ? `${queue.lastDatatake.start.slice(5, 16)} (${(queue.lastDatatake.durS / 60).toFixed(1)} min, ${queue.lastDatatake.scenes} scenes)` : "—"}, next {queue.nextDatatake ? queue.nextDatatake.start.slice(5, 16) : "—"}</span>
                </>) : <span className="text-red-500/60">loading the ESA acquisition plan…</span>}
              </div>
            )}
          </div>
          </>)}
        </div>

        <div className="flex flex-wrap gap-1">
          {(["delivery", "link", "passes", "sat"] as const).map((t) => <Btn key={t} active={tab === t} onClick={() => { setTab(t); setShowResults(true); }}>{t === "sat" ? "in view" : t}</Btn>)}
          <Btn active={wide} onClick={() => setWide((v) => !v)} title="stretch the right column">{wide ? "narrow" : "stretch"}</Btn>
          <Btn active={!showResults} onClick={() => setShowResults((v) => !v)} title="show or hide the results panel">{showResults ? "hide" : "show"}</Btn>
          <button onClick={downloadPdf} disabled={pdfBusy || !entry} title="PDF report: communication path, latency terms, link budget, 48 h passes, payload comparison, assumptions and sources" className="ml-auto border border-amber-400/60 bg-amber-500/15 px-2 py-0.5 uppercase tracking-wider text-amber-200 hover:bg-amber-500/30 disabled:opacity-40">
            {pdfBusy ? "building…" : "download PDF report"}
          </button>
        </div>

        {showResults && (<div className="flex-1 space-y-1 overflow-y-auto border border-green-500/30 bg-black/75 p-2">
          {tab === "delivery" && entry && (
            <>
              <p className="text-green-200">DELIVERY OF {fmtBits(payloadBits)} FROM {sats?.[selected!]?.name} TO {dataCentre.name.toUpperCase()}</p>
              <p className="text-green-600">t₀ = {fmtT(t0.at)} UTC — {t0.why}</p>
              {t0.target && <p className="text-orange-300/80">target pass: {fmtT(t0.target.aos)} → {fmtT(t0.target.los)}, max EL {t0.target.maxElDeg.toFixed(0)}° (off-nadir limit {offNadir}° ⇒ EL ≥ {minElForOffNadir(entry.altitudeKm, offNadir).toFixed(0)}°)</p>}
              {routes.map((r) => (
                <div key={r.id} className={`mt-1 border p-1 ${r.available ? "border-green-500/30" : "border-green-900"}`}>
                  <div className="flex justify-between"><span className={r.available ? "text-green-100" : "text-green-700"}>{r.name}</span><span className={r.available ? "text-amber-200" : "text-green-800"}>{r.available ? fmtS(r.totalS) : "n/a"}</span></div>
                  {r.available ? (<>
                    <p className="text-green-600">via {r.via}{r.passesUsed > 1 ? ` • ${r.passesUsed} passes` : ""} • arrives {r.deliveredAt && fmtT(r.deliveredAt)} UTC</p>
                    {r.terms.map((t, i) => <Row key={i} k={t.label + (t.note ? ` (${t.note})` : "")} v={fmtS(t.seconds)} dim={t.seconds === 0} />)}
                  </>) : <p className="text-green-800">{r.why}</p>}
                </div>
              ))}
              {timing && lb && (
                <div className="mt-1 border border-amber-500/30 p-1 text-amber-100/90">
                  <p className="text-amber-200">THE PAYLOAD ON THE RADIO ({linkNow ? "link now" : "next pass, best geometry"})</p>
                  <Row k="information bits" v={fmtBits(timing.payloadBits)} />
                  <Row k="channel bits sent (CCSDS frames of 1,115 B)" v={fmtBits(timing.channelBits)} />
                  <Row k={`serialisation at ${fmtRate(lb.rateBps)}`} v={`${fmtS(timing.serialS)} (payload) / ${fmtS(timing.framedS)} (framed)`} />
                  <Row k="P(any bit error) coded / uncoded" v={`${timing.pErrorCoded.toExponential(1)} / ${timing.pErrorUncoded < 1e-3 ? timing.pErrorUncoded.toExponential(1) : timing.pErrorUncoded.toFixed(3)}`} />
                  {entry.ttc && <Row k={`same payload on the ${entry.ttc.band}-band TT&C channel (${fmtRate(entry.ttc.rateMbps * 1e6)})`} v={fmtS(Math.max(payloadBits, 1115 * 8) / (entry.ttc.rateMbps * 1e6))} />}
                </div>
              )}
              <p className="pt-2 text-green-200">SAME ROUTES, EVERY PAYLOAD (what the frog link buys)</p>
              <div className="space-y-1 text-[11px]">
                <div className="grid grid-cols-5 gap-1 text-green-700"><span>direct X-band</span><span>GEO relay</span><span>own antenna</span><span>S-band TT&C</span><span>SBD relay</span></div>
                {comparison.map(({ p, direct, relay, own, ttc, sbd }) => {
                  const cell = (r: RouteResult | null) => !r ? "—" : r.available ? fmtS(r.totalS) + (r.passesUsed > 1 ? ` (${r.passesUsed}p)` : "") : "n/a";
                  return (
                    <div key={p.id} className={`border-t border-green-900/60 pt-0.5 ${p.id === payloadId && !customBits ? "text-green-100" : p.id.startsWith("frog") ? "text-amber-200/90" : "text-green-400"}`}>
                      <div className="flex justify-between"><span>{p.name}</span><span className="text-green-600">{fmtBits(p.bits)}</span></div>
                      <div className="grid grid-cols-5 gap-1"><span>{cell(direct)}</span><span>{cell(relay)}</span><span>{cell(own)}</span><span>{cell(ttc)}</span><span>{cell(sbd)}</span></div>
                    </div>
                  );
                })}
              </div>
              <p className="pt-1 text-green-800">Reading: on the X-band payload link every byte queues behind the recorder backlog and competes for transmitter duty cycle, which is why real missions quote hours. A semantic message of a few hundred bits can skip that queue (priority) or avoid the payload link entirely by riding the S-band telemetry channel through every station of the network; what then decides the delay is only whether a station or a relay is in view when the message is created. See docs/LATENCY_RESEARCH.md.</p>
            </>
          )}

          {tab === "link" && entry && (
            <>
              <p className="text-green-200">LINK BUDGET {linkNow ? `NOW → ${best!.st.name}` : nextContact ? `AT THE NEXT PASS (${stations.find((s) => s.id === nextContact.observerId)?.name}, max EL)` : "(no contact in 24 h)"}</p>
              {lb ? (<>
                <Row k="frequency" v={`${(lb.freqMHz / 1000).toFixed(3)} GHz (${entry.downlink.band}-band)`} />
                <Row k="slant range / elevation" v={`${(best?.look.rangeKm ?? nextContact?.minRangeKm ?? 0).toFixed(0)} km / ${(best?.look.elDeg ?? nextContact?.maxElDeg ?? 0).toFixed(1)}°`} />
                <Row k="one-way propagation delay" v={`${lb.propDelayMs.toFixed(2)} ms`} />
                <Row k="Doppler shift (range-rate)" v={`${(lb.dopplerHz / 1e3).toFixed(1)} kHz (${best ? best.look.rangeRateKmS.toFixed(2) : "0"} km/s)`} />
                <p className="pt-1 text-green-200">GAINS AND LOSSES (dB)</p>
                <Row k={`satellite EIRP${entry.downlink.eirpAssumed ? " (assumed)" : ""}`} v={`${lb.eirpdBW.toFixed(1)} dBW`} />
                <Row k="free-space path loss 20log(4πd/λ)" v={`−${lb.fspldB.toFixed(1)}`} />
                <Row k="atmospheric gases (ITU-R P.676)" v={`−${lb.atmosdB.toFixed(2)}`} />
                <Row k={`rain ${rain} mm/h (ITU-R P.838)`} v={`−${lb.raindB.toFixed(2)}`} />
                <Row k="pointing + polarisation" v={`−${(lb.pointingdB + lb.poldB).toFixed(1)}`} />
                <Row k={`ground antenna ${dishM} m, η 0.6`} v={`+${lb.groundGaindBi.toFixed(1)} dBi`} />
                <Row k={`G/T (Tsys ${tsys} K)`} v={`${lb.gtdBK.toFixed(1)} dB/K`} />
                <Row k="received power" v={`${lb.rxPowerdBW.toFixed(1)} dBW (${(Math.pow(10, lb.rxPowerdBW / 10) * 1e12).toFixed(2)} pW)`} />
                <p className="pt-1 text-green-200">NOISE</p>
                <Row k="noise density N₀ = kT" v={`${lb.noiseDensitydBWHz.toFixed(1)} dBW/Hz`} />
                <Row k={`occupied bandwidth (${(lb.symbolRate / 1e6).toFixed(0)} Msym/s × 1.35)`} v={`${(lb.bwHz / 1e6).toFixed(0)} MHz`} />
                <Row k="noise power in band" v={`${lb.noisePowerdBW.toFixed(1)} dBW`} />
                <Row k="C/N₀" v={`${lb.cn0dBHz.toFixed(1)} dB-Hz`} />
                <Row k="SNR in band" v={`${lb.snrdB.toFixed(1)} dB`} />
                <Row k={`Eb/N₀ at ${fmtRate(lb.rateBps)}`} v={`${lb.ebn0dB.toFixed(1)} dB`} />
                <Row k={`required Eb/N₀ (${entry.downlink.modulation.split(",")[0]}, r=${entry.downlink.codeRate.toFixed(2)}) + 1.5 impl.`} v={`${(lb.reqEbN0dB + lb.implLossdB).toFixed(1)} dB`} />
                <Row k="LINK MARGIN" v={<span className={lb.margindB >= 3 ? "text-green-300" : lb.margindB >= 0 ? "text-amber-300" : "text-red-400"}>{lb.margindB.toFixed(1)} dB {lb.margindB >= 3 ? "OK" : lb.margindB >= 0 ? "THIN" : "LINK FAILS"}</span>} />
                <Row k="BER uncoded QPSK / coded (model)" v={`${lb.berUncoded.toExponential(1)} / ${lb.berCoded.toExponential(1)}`} />
                <Row k="Shannon capacity in this band at this SNR" v={fmtRate(lb.shannonBps)} />
                <Row k="nominal rate / capacity" v={`${((lb.rateBps / lb.shannonBps) * 100).toFixed(0)} %`} />
                {dcDistKm != null && <Row k={`fibre ${best!.st.name} → ${dataCentre.name}`} v={`${dcDistKm.toFixed(0)} km great circle`} />}
                <p className="pt-1 text-green-800">Assumptions: EIRP per catalogue (assumed where flagged), antenna efficiency 0.6, pointing 0.5 dB, polarisation 0.3 dB, implementation 1.5 dB, roll-off 0.35, required Eb/N₀ from CCSDS 130.1-G performance curves. Change the dish, Tsys and rain on the panel above.</p>
              </>) : <p className="text-green-700">no station of this network sees the satellite in the next 24 h</p>}
            </>
          )}

          {tab === "passes" && (
            <>
              <p className="text-green-200">CONTACTS IN THE NEXT 48 H ({contactsNet.length} over {stations.length} stations, mask {minEl}°)</p>
              {pred && target && (
                <p className="text-orange-300/80">target imaging opportunities: {pred.contacts.filter((c) => c.observerId === "target").map((c) => `${fmtT(c.aos).slice(6)} (${c.maxElDeg.toFixed(0)}°)`).join(", ") || "none"}</p>
              )}
              {details && (
                <p className="text-cyan-400">
                  <a href={`https://www.heavens-above.com/PassSummary.aspx?satid=${details.noradId}&lat=${dataCentre.latDeg.toFixed(4)}&lng=${dataCentre.lonDeg.toFixed(4)}&loc=${encodeURIComponent(dataCentre.name)}&alt=0&tz=UCT&showAll=t`} target="_blank" rel="noopener noreferrer" className="underline">CHECK THE DATA-CENTRE PASSES ON HEAVENS-ABOVE ↗</a>
                  <span className="text-cyan-800"> (independent SGP4; Heavens-Above uses a 10° mask, so its start/end times sit inside ours)</span>
                </p>
              )}
              {pred && (<p className="text-pink-300/80">passes over the data centre itself: {pred.contacts.filter((c) => c.observerId === "dc").map((c) => `${fmtT(c.aos).slice(6)} (${c.maxElDeg.toFixed(0)}°)`).join(", ") || "none"}</p>)}
              {pred && relays.length > 0 && (<p className="text-amber-300/80">GEO relay line of sight: {pred.geoWindows.slice(0, 6).map((w) => `${w.relayName.split(" ")[0]} ${fmtT(w.start).slice(6)}–${fmtT(w.end).slice(6)}`).join("; ")}</p>)}
              <table className="w-full text-left text-[11px]">
                <thead><tr className="text-green-600"><th>AOS (UTC)</th><th>station</th><th>dur</th><th>max EL</th><th>min rng</th><th>AZ</th><th></th></tr></thead>
                <tbody>
                  {contactsNet.slice(0, 60).map((c, i) => {
                    const st = stations.find((s) => s.id === c.observerId)!;
                    const isNext = nextContact && c.aos.getTime() === nextContact.aos.getTime() && c.observerId === nextContact.observerId;
                    return (
                      <tr key={i} className={isNext ? "text-green-100" : "text-green-400"}>
                        <td>{fmtT(c.aos).slice(0, 14)}</td><td>{st.name.split(" (")[0].slice(0, 14)}</td><td>{Math.round(c.durationS / 60)} min</td><td>{c.maxElDeg.toFixed(0)}°</td><td>{c.minRangeKm.toFixed(0)} km</td><td>{c.aosAzDeg.toFixed(0)}→{c.losAzDeg.toFixed(0)}</td>
                        <td><button onClick={() => jumpTo(c.aos)} className="text-cyan-400">▶</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}

          {tab === "sat" && (
            <>
              <p className="text-green-200">STATIONS SEEING {sats?.[selected!]?.name} NOW (EL ≥ {minEl}°): {inView.length}</p>
              {inView.map(({ st, look }) => (
                <div key={st.id} className="flex justify-between text-cyan-300"><span>{st.name} <span className="text-cyan-700">{st.network}</span></span><span>EL {look.elDeg.toFixed(1)}° AZ {look.azDeg.toFixed(0)}° {look.rangeKm.toFixed(0)} km {(look.rangeKm / 299792.458 * 1000).toFixed(2)} ms</span></div>
              ))}
              {inView.length === 0 && <p className="text-green-700">none — the satellite is between passes{nextContact ? `; next ${stations.find((s) => s.id === nextContact.observerId)?.name} at ${fmtT(nextContact.aos)} UTC` : ""}</p>}
              <p className="pt-1 text-amber-300">GEO RELAY: {relays.length ? (geoNow ? `${geoNow.name} in line of sight` : `${relays.map((r) => r.name.split(" ")[0]).join(", ")} behind the Earth`) : `none (${entry?.family} has no relay terminal)`}</p>
              <p className="pt-2 text-green-200">STATION LIST ({stations.length})</p>
              {stations.map((s) => <p key={s.id} className="text-green-600">{s.name} — {s.network} — {s.latDeg.toFixed(2)}, {s.lonDeg.toFixed(2)} — {s.bands.join("/")} — {s.dishM} m <span className="text-green-800">[{s.source}]</span></p>)}
            </>
          )}
        </div>)}
      </div>
    </div>
  );
}
