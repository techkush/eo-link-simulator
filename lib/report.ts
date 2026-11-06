/**
 * PDF report: communication path, latency, link budget, passes, assumptions and sources,
 * generated in the browser from the live state with jsPDF.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SatData, SatDetails, SatState, Look } from "./satellites";
import type { CatalogEntry } from "./catalog";
import type { GroundStation, DataCentre } from "./stations";
import type { LinkBudget, PayloadTiming } from "./link";
import { fmtS, fmtBits, fmtRate, CCSDS_FRAME_BITS } from "./link";
import type { Contact, GeoWindow } from "./passes";
import type { RouteResult } from "./routes";

export interface ReportInput {
  sat: SatData;
  entry: CatalogEntry;
  details: SatDetails;
  state: SatState | null;
  simTime: Date;
  dataCentre: DataCentre;
  target: { name: string; latDeg: number; lonDeg: number } | null;
  offNadirDeg: number;
  stations: GroundStation[];
  networkName: string;
  minElDeg: number;
  dishM: number;
  tSysK: number;
  rainMmH: number;
  payloadName: string;
  payloadBits: number;
  payloadSource: string;
  lb: LinkBudget | null;
  lbIsNow: boolean;
  lbStation: GroundStation | null;
  lbLook: { rangeKm: number; elDeg: number; rangeRateKmS: number } | null;
  timing: PayloadTiming | null;
  routes: RouteResult[];
  t0: { at: Date; why: string };
  comparison: { name: string; bits: number; direct: RouteResult; relay: RouteResult; own: RouteResult; ttc: RouteResult | null; sbd: RouteResult | null }[];
  backlogGB: number;
  priority: boolean;
  dutyMin: number | null;
  dailyVolume: string;
  sbandStationCount: number;
  queueNote: string | null;
  contacts: Contact[];
  geoWindows: GeoWindow[];
  inView: { st: GroundStation; look: Look }[];
  relayNow: string | null;
  globePng: string | null;
}

const ascii = (s: string) =>
  s.replace(/→/g, "->").replace(/−/g, "-").replace(/₀/g, "0").replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/—/g, "-").replace(/•/g, "-").replace(/η/g, "eta").replace(/λ/g, "lambda").replace(/π/g, "pi").replace(/ ⇒ /g, " => ").replace(/t₀/g, "t0");
const fmtT = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19) + " UTC";

export function buildReport(r: ReportInput): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210, M = 15;
  let y = M;
  const C = { ink: [20, 20, 20] as [number, number, number], dim: [110, 110, 110] as [number, number, number], acc: [0, 90, 140] as [number, number, number] };

  const newPageIfNeeded = (need: number) => { if (y + need > 282) { doc.addPage(); y = M; } };
  const h1 = (t: string) => { newPageIfNeeded(14); doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.setTextColor(...C.acc); doc.text(ascii(t), M, y); y += 7; doc.setTextColor(...C.ink); };
  const h2 = (t: string) => { newPageIfNeeded(10); doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(ascii(t), M, y); y += 5.5; };
  const p = (t: string, size = 9.5, color: [number, number, number] = C.ink) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(ascii(t), W - 2 * M) as string[];
    newPageIfNeeded(lines.length * size * 0.45 + 2);
    doc.text(lines, M, y); y += lines.length * size * 0.45 + 2; doc.setTextColor(...C.ink);
  };
  const table = (head: string[], body: (string | number)[][], opts: { widths?: number[]; size?: number } = {}) => {
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, head: [head.map(ascii)], body: body.map((row) => row.map((c) => ascii(String(c)))),
      styles: { font: "helvetica", fontSize: opts.size ?? 8.5, cellPadding: 1.2, textColor: C.ink }, headStyles: { fillColor: [230, 238, 245], textColor: C.acc, fontStyle: "bold" },
      columnStyles: opts.widths ? Object.fromEntries(opts.widths.map((w, i) => [i, { cellWidth: w }])) : undefined, theme: "grid",
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
  };

  /* ---------- title ---------- */
  doc.setFont("helvetica", "bold"); doc.setFontSize(18); doc.setTextColor(...C.acc);
  doc.text("Earth-observation link report", M, y); y += 8;
  doc.setFontSize(12); doc.setTextColor(...C.ink);
  doc.text(ascii(`${r.sat.name} -> ${r.dataCentre.name}`), M, y); y += 6;
  p(`Generated ${fmtT(new Date())}. Simulation clock ${fmtT(r.simTime)}. Payload: ${r.payloadName} (${fmtBits(r.payloadBits)}). Station network: ${r.networkName} (${r.stations.length} sites with ${r.entry.downlink.band}-band, elevation mask ${r.minElDeg} deg). ${r.target ? `Target: ${r.target.name} (${r.target.latDeg.toFixed(2)}, ${r.target.lonDeg.toFixed(2)}), off-nadir <= ${r.offNadirDeg} deg.` : "No target: the message is created on board now."}`, 9.5, C.dim);
  if (r.globePng) {
    try {
      const img = r.globePng; const props = doc.getImageProperties(img); const aspect = props.height / props.width; const iw = W - 2 * M; const ih = iw * aspect;
      newPageIfNeeded(ih + 5); doc.addImage(img, "JPEG", M, y, iw, ih, undefined, "FAST"); y += ih + 3;
    } catch { /* ignore */ }
    p("Globe at the simulation time: selected satellite (yellow diamond) with its footprint at the elevation mask and ground track; stations (cyan, white when in view); data centre (magenta) with the fibre arc from the receiving station; target (orange); GEO relays (yellow, far out).", 8, C.dim);
  }

  /* ---------- 1 satellite ---------- */
  h1("1. The satellite");
  table(["item", "value"], [
    ["Name / NORAD / COSPAR", `${r.sat.name} / ${r.details.noradId} / ${r.details.cospar}`],
    ["Family / operator", `${r.entry.family} / ${r.entry.operator}`],
    ["Sensor / resolution / swath", `${r.entry.sensor}; ${r.entry.resolution}${r.entry.swathKm ? `; ${r.entry.swathKm} km` : ""}`],
    ["Position at simulation time", r.state ? `lat ${r.state.latDeg.toFixed(3)} deg, lon ${r.state.lonDeg.toFixed(3)} deg, alt ${r.state.altKm.toFixed(1)} km, ${r.state.speedKmS.toFixed(3)} km/s` : "n/a"],
    ["Orbit", `incl ${r.details.inclinationDeg.toFixed(3)} deg, period ${r.details.periodMin.toFixed(2)} min (${r.details.revsPerDay.toFixed(3)} rev/day), perigee ${r.details.perigeeKm.toFixed(0)} km, apogee ${r.details.apogeeKm.toFixed(0)} km, e ${r.details.eccentricity.toFixed(6)}`],
    ["Elements", `epoch ${fmtT(r.details.epoch)} (age ${((Date.now() - r.details.epoch.getTime()) / 3600000).toFixed(1)} h); CelesTrak GP data, SGP4 propagation`],
    ["TLE line 1", r.sat.line1], ["TLE line 2", r.sat.line2],
  ], { widths: [50, 130], size: 8 });
  h2("Payload downlink (" + r.entry.confidence.toUpperCase() + ")");
  table(["parameter", "value"], [
    ["Band / centre frequency", `${r.entry.downlink.band}-band, ${(r.entry.downlink.freqMHz / 1000).toFixed(4)} GHz`],
    ["Nominal data rate", fmtRate(r.entry.downlink.rateMbps * 1e6)],
    ["Modulation / coding", `${r.entry.downlink.modulation}; ${r.entry.downlink.bitsPerSymbol} bit/symbol, code rate ${r.entry.downlink.codeRate.toFixed(3)}; required Eb/N0 ${r.entry.downlink.reqEbN0dB} dB`],
    ["Satellite EIRP", `${r.entry.downlink.eirpdBW} dBW${r.entry.downlink.eirpAssumed ? " (ASSUMED - not published)" : ""}`],
    ["TT&C channel", r.entry.ttc ? `${r.entry.ttc.band}-band ${r.entry.ttc.freqMHz} MHz, ${fmtRate(r.entry.ttc.rateMbps * 1e6)}` : "n/a"],
    ["Direct broadcast", r.entry.directBroadcast ? `${r.entry.directBroadcast.freqMHz} MHz, ${r.entry.directBroadcast.rateMbps} Mbit/s` : "none"],
    ["GEO relay", r.entry.relay ? `${r.entry.relay.system}, ${fmtRate(r.entry.relay.rateMbps * 1e6)} - ${r.entry.relay.note}` : "none (no relay terminal)"],
    ["Sources", r.entry.sources.join(" | ")],
  ], { widths: [45, 135], size: 8 });

  /* ---------- 2 path ---------- */
  h1("2. The communication path and where the time goes");
  p(`Message creation time t0 = ${fmtT(r.t0.at)}: ${r.t0.why}. Payload ${fmtBits(r.payloadBits)} (${r.payloadSource}). Every route below is computed for this payload from the 48 h contact prediction; a payload larger than one pass can carry is drained over successive passes.`);
  if (r.queueNote) p(r.queueNote, 9);
  p(`On-board queue: ${r.priority ? "the payload has PRIORITY and jumps the recorder queue" : `${r.backlogGB.toFixed(1)} GB already in the recorder ahead of the payload, drained first-in-first-out at the payload rate`} (mission volume ${r.dailyVolume}). Transmitter duty cycle: ${r.dutyMin ? `${r.dutyMin} min per orbit on the payload link` : "no cap"}. The TT&C route uses the ${r.sbandStationCount} S-band stations of the network, has no recorder queue and spends no payload-transmitter time.`);
  for (const route of r.routes) {
    newPageIfNeeded(40);
    h2(`${route.name}: ${route.available ? fmtS(route.totalS) : "not available"}`);
    if (!route.available) { p(route.why ?? "", 9, C.dim); continue; }
    // path diagram
    const boxes = route.id === "direct" || route.id === "ttc" ? [r.sat.name, route.via, "fibre", r.dataCentre.name]
      : route.id === "sbd" ? [r.sat.name, "Iridium constellation", "Tempe gateway", "fibre", r.dataCentre.name]
      : route.id === "relay" ? [r.sat.name, route.via.split(" → ")[0] ?? "GEO", route.via.split(" → ")[1] ?? "gateway", "fibre", r.dataCentre.name]
      : [r.sat.name, `antenna at ${r.dataCentre.name}`, r.dataCentre.name];
    const n = boxes.length, gap = 6, bw = (W - 2 * M - gap * (n - 1)) / n, bh = 11;
    doc.setFontSize(7.5); doc.setFont("helvetica", "normal");
    boxes.forEach((b, i) => {
      const x = M + i * (bw + gap);
      doc.setDrawColor(...C.acc); doc.setFillColor(240, 246, 252); doc.roundedRect(x, y, bw, bh, 1.5, 1.5, "FD");
      doc.setTextColor(...C.ink);
      const lines = doc.splitTextToSize(ascii(b), bw - 2) as string[];
      doc.text(lines.slice(0, 2), x + bw / 2, y + (lines.length > 1 ? 4.5 : 6.5), { align: "center" });
      if (i < n - 1) { doc.setDrawColor(...C.dim); doc.line(x + bw, y + bh / 2, x + bw + gap, y + bh / 2); doc.line(x + bw + gap - 1.5, y + bh / 2 - 1.2, x + bw + gap, y + bh / 2); doc.line(x + bw + gap - 1.5, y + bh / 2 + 1.2, x + bw + gap, y + bh / 2); }
    });
    y += bh + 4;
    // timeline bar
    const total = route.totalS;
    const barW = W - 2 * M;
    let x = M;
    const shades: [number, number, number][] = [[200, 60, 60], [60, 130, 200], [60, 170, 90], [200, 120, 40], [120, 120, 120], [160, 90, 180]];
    route.terms.forEach((t, i) => {
      const w = total > 0 ? Math.max((t.seconds / total) * barW, t.seconds > 0 ? 0.6 : 0) : 0;
      doc.setFillColor(...shades[i % shades.length]); doc.rect(x, y, w, 4, "F"); x += w;
    });
    doc.setDrawColor(...C.dim); doc.rect(M, y, barW, 4);
    y += 6;
    table(["term", "time", "share", "note"], route.terms.map((t) => [t.label, fmtS(t.seconds), total > 0 ? `${((t.seconds / total) * 100).toFixed(1)} %` : "-", t.note ?? ""]), { widths: [70, 28, 18, 64], size: 8 });
    p(`Total ${fmtS(route.totalS)}; the payload arrives at ${route.deliveredAt ? fmtT(route.deliveredAt) : "-"}${route.passesUsed > 1 ? ` after ${route.passesUsed} passes` : ""}. Space-segment rate ${fmtRate(route.rateBps)}.`, 9, C.dim);
  }
  if (r.timing && r.lb) {
    newPageIfNeeded(45);
    h2("The payload on the radio");
    table(["quantity", "value"], [
      ["Information bits", fmtBits(r.timing.payloadBits)],
      ["Channel bits actually sent", `${fmtBits(r.timing.channelBits)} (CCSDS AOS frames of ${CCSDS_FRAME_BITS / 8} bytes; one frame minimum)`],
      [`Serialisation at ${fmtRate(r.lb.rateBps)}`, `${fmtS(r.timing.serialS)} for the payload bits; ${fmtS(r.timing.framedS)} framed`],
      ["P(at least one bit error), coded link", r.timing.pErrorCoded.toExponential(2)],
      ["P(at least one bit error), uncoded QPSK", r.timing.pErrorUncoded < 1e-3 ? r.timing.pErrorUncoded.toExponential(2) : r.timing.pErrorUncoded.toFixed(4)],
      ...(r.entry.ttc ? [[`Same payload on the ${r.entry.ttc.band}-band TT&C channel (${fmtRate(r.entry.ttc.rateMbps * 1e6)})`, fmtS(Math.max(r.payloadBits, CCSDS_FRAME_BITS) / (r.entry.ttc.rateMbps * 1e6))]] : []),
    ], { widths: [80, 100], size: 8 });
  }
  p("Reading: for a semantic message of a few hundred bits the radio time is microseconds and the fibre tens of milliseconds; the delay is decided by whether a station or a relay is in view when the message is created. The frog link gains nothing from a faster radio and everything from an always-on low-rate channel.", 9);

  /* ---------- 3 link budget ---------- */
  h1("3. Link budget and noise");
  if (r.lb && r.lbLook) {
    p(r.lbIsNow ? `Computed for the link now, to ${r.lbStation?.name ?? "station"} (${r.lbStation?.network ?? ""}).` : `No station of the network sees the satellite now; computed at the best geometry (closest approach) of the next pass over ${r.lbStation?.name ?? "station"}.`, 9, C.dim);
    const lb = r.lb;
    table(["quantity", "value", "how"], [
      ["Frequency", `${(lb.freqMHz / 1000).toFixed(4)} GHz`, "catalogue"],
      ["Slant range / elevation", `${r.lbLook.rangeKm.toFixed(1)} km / ${r.lbLook.elDeg.toFixed(2)} deg`, "SGP4 position vs station"],
      ["One-way propagation delay", `${lb.propDelayMs.toFixed(3)} ms`, "range / c"],
      ["Doppler shift", `${(lb.dopplerHz / 1e3).toFixed(2)} kHz`, `range-rate ${r.lbLook.rangeRateKmS.toFixed(3)} km/s x f / c`],
      ["Satellite EIRP", `${lb.eirpdBW.toFixed(1)} dBW${r.entry.downlink.eirpAssumed ? " (assumed)" : ""}`, "catalogue"],
      ["Free-space path loss", `-${lb.fspldB.toFixed(2)} dB`, "32.45 + 20 log f[MHz] + 20 log d[km]"],
      ["Atmospheric gases", `-${lb.atmosdB.toFixed(2)} dB`, "ITU-R P.676 zenith value / sin(el)"],
      [`Rain ${r.rainMmH} mm/h`, `-${lb.raindB.toFixed(2)} dB`, "ITU-R P.838 k R^alpha x effective path (3 km rain height)"],
      ["Pointing + polarisation", `-${(lb.pointingdB + lb.poldB).toFixed(1)} dB`, "0.5 + 0.3 dB assumed"],
      [`Ground antenna ${r.dishM} m`, `+${lb.groundGaindBi.toFixed(2)} dBi`, "10 log(eta (pi D / lambda)^2), eta 0.6"],
      [`G/T (Tsys ${r.tSysK} K)`, `${lb.gtdBK.toFixed(2)} dB/K`, "G - 10 log Tsys"],
      ["Received carrier power", `${lb.rxPowerdBW.toFixed(2)} dBW (${(Math.pow(10, lb.rxPowerdBW / 10) * 1e12).toFixed(3)} pW)`, "EIRP + G - losses"],
      ["Noise density N0 = k Tsys", `${lb.noiseDensitydBWHz.toFixed(2)} dBW/Hz`, "k = 1.380649e-23 J/K"],
      ["Occupied bandwidth", `${(lb.bwHz / 1e6).toFixed(2)} MHz`, `${(lb.symbolRate / 1e6).toFixed(2)} Msym/s x (1 + 0.35 roll-off)`],
      ["Noise power in band", `${lb.noisePowerdBW.toFixed(2)} dBW`, "N0 + 10 log B"],
      ["C/N0", `${lb.cn0dBHz.toFixed(2)} dB-Hz`, "EIRP + G/T - losses + 228.6"],
      ["SNR in band", `${lb.snrdB.toFixed(2)} dB`, "C - N"],
      [`Eb/N0 at ${fmtRate(lb.rateBps)}`, `${lb.ebn0dB.toFixed(2)} dB`, "C/N0 - 10 log Rb"],
      ["Required Eb/N0 + implementation", `${(lb.reqEbN0dB + lb.implLossdB).toFixed(2)} dB`, `${r.entry.downlink.modulation}, r=${r.entry.downlink.codeRate.toFixed(2)} (CCSDS 130.1-G) + 1.5 dB`],
      ["LINK MARGIN", `${lb.margindB.toFixed(2)} dB (${lb.margindB >= 3 ? "OK" : lb.margindB >= 0 ? "thin" : "link fails"})`, ""],
      ["BER uncoded QPSK", lb.berUncoded.toExponential(2), "0.5 erfc(sqrt(Eb/N0))"],
      ["BER coded (model)", lb.berCoded.toExponential(2), "1e-6 at the requirement, one decade per 0.3 dB"],
      ["Shannon capacity in this band", fmtRate(lb.shannonBps), "B log2(1 + SNR)"],
      ["Nominal rate / capacity", `${((lb.rateBps / lb.shannonBps) * 100).toFixed(1)} %`, ""],
    ], { widths: [52, 58, 70], size: 8 });
  } else p("No station of the chosen network sees the satellite within 48 h; no budget computed.", 9, C.dim);

  /* ---------- 4 passes ---------- */
  h1("4. Contacts in the next 48 h");
  p(`Stations in view now (EL >= ${r.minElDeg} deg): ${r.inView.length ? r.inView.map((v) => `${v.st.name} EL ${v.look.elDeg.toFixed(1)} deg, ${v.look.rangeKm.toFixed(0)} km`).join("; ") : "none"}. GEO relay: ${r.relayNow ?? (r.entry.relay ? "not in line of sight" : "none")}.`, 9, C.dim);
  const stMap = new Map(r.stations.map((s) => [s.id, s]));
  const net = r.contacts.filter((c) => stMap.has(c.observerId)).slice(0, 80);
  table(["AOS (UTC)", "LOS", "station", "network", "dur", "max EL", "min range", "AZ AOS->LOS"],
    net.map((c) => [fmtT(c.aos).slice(5, 19), fmtT(c.los).slice(11, 19), stMap.get(c.observerId)!.name, stMap.get(c.observerId)!.network, `${(c.durationS / 60).toFixed(1)} min`, `${c.maxElDeg.toFixed(0)} deg`, `${c.minRangeKm.toFixed(0)} km`, `${c.aosAzDeg.toFixed(0)} -> ${c.losAzDeg.toFixed(0)}`]),
    { size: 7.5 });
  const dc = r.contacts.filter((c) => c.observerId === "dc");
  p(`Passes over the data centre itself (${r.dataCentre.name}): ${dc.length ? dc.map((c) => `${fmtT(c.aos).slice(5, 16)} (${c.maxElDeg.toFixed(0)} deg, ${(c.durationS / 60).toFixed(0)} min)`).join("; ") : "none"}.`, 9);
  if (r.target) {
    const tg = r.contacts.filter((c) => c.observerId === "target");
    p(`Imaging opportunities over the target (off-nadir <= ${r.offNadirDeg} deg): ${tg.length ? tg.map((c) => `${fmtT(c.aos).slice(5, 16)} (EL ${c.maxElDeg.toFixed(0)} deg)`).join("; ") : "none within 48 h"}.`, 9);
  }
  if (r.geoWindows.length) p(`GEO relay line-of-sight windows: ${r.geoWindows.slice(0, 12).map((w) => `${w.relayName.split(" (")[0]} ${fmtT(w.start).slice(5, 16)} - ${fmtT(w.end).slice(11, 16)}`).join("; ")}.`, 9);

  /* ---------- 5 comparison ---------- */
  h1("5. Same routes, every payload");
  table(["payload", "bits", "direct X-band", "GEO relay", "own antenna", "S-band TT&C", "SBD relay"],
    r.comparison.map((c) => [c.name, fmtBits(c.bits), c.direct.available ? fmtS(c.direct.totalS) + (c.direct.passesUsed > 1 ? ` (${c.direct.passesUsed} p)` : "") : "n/a", c.relay.available ? fmtS(c.relay.totalS) : "-", c.own.available ? fmtS(c.own.totalS) + (c.own.passesUsed > 1 ? ` (${c.own.passesUsed} p)` : "") : "n/a", c.ttc ? (c.ttc.available ? fmtS(c.ttc.totalS) + (c.ttc.passesUsed > 1 ? ` (${c.ttc.passesUsed} p)` : "") : "n/a") : "-", c.sbd ? (c.sbd.available ? fmtS(c.sbd.totalS) : "n/a") : "-"]),
    { widths: [50, 18, 28, 20, 24, 22, 18], size: 7 });

  /* ---------- 6 assumptions ---------- */
  h1("6. Methods, assumptions and sources");
  p("Orbits: CelesTrak GP element sets (US Space Force catalogue) propagated with SGP4 (satellite.js). Accuracy about 1 km at the element epoch, degrading with age. Positions and pass times were cross-checked against the independent Python sgp4 package (agreement < 0.06 deg, pass times within 10 s) and against Heavens-Above (same passes; it uses a 10 deg mask).");
  p("Contacts: 48 h scan at 20 s with AOS/LOS refined by bisection to under 1 s, above the chosen elevation mask. Target opportunities use the elevation equivalent to the maximum off-nadir angle: cos(el) = sin(eta) (R + h) / R. GEO relay line of sight: the LEO-GEO segment must clear the Earth by 60 km.");
  p("Delivery time = waiting for the next contact (multi-pass drain for large files, at the nominal rate) + propagation (range / c) + serialisation (payload bits in CCSDS AOS frames of 1,115 bytes, one frame minimum, at the nominal rate) + terrestrial fibre (great-circle distance x 1.5 route factor at 2/3 c plus 0.5 ms per hop for 12 hops) + the ground processing time entered. GEO relay: LEO-GEO about 37,800 km, GEO-gateway from geometry, relay rate from the catalogue, fibre from the gateway.");
  p("Link budget: free-space loss, ITU-R P.676 gaseous absorption (zenith value / sin el), ITU-R P.838 rain (k, alpha at the band; 3 km rain height; P.618 reduction), pointing 0.5 dB, polarisation 0.3 dB, implementation 1.5 dB, antenna efficiency 0.6, roll-off 0.35, required Eb/N0 from CCSDS 130.1-G performance curves. Uncoded BER = 0.5 erfc(sqrt(Eb/N0)); coded BER is a waterfall model (1e-6 at the requirement, one decade per 0.3 dB, floor 1e-12), indicative only.");
  p("Why real missions quote hours (docs/LATENCY_RESEARCH.md): a satellite has about 10 minutes of ground contact per 100-minute orbit and 4-6 windows a day with any one station; it collects 0.5-1.5 TB/day into its recorder, so imagery queues for hours behind earlier data and the X-band transmitter is duty-cycle limited (Sentinel-1: 30 min per orbit); then the product is processed under a timeliness policy (Sentinel NRT 1-3 h, standard 24 h; Landsat ~5 h). The simulator models the queue (backlog, FIFO or priority), the duty cap and the processing time; a semantic message avoids the queue and the payload transmitter entirely on the TT&C route.");
  p("What is NOT modelled: station scheduling and contention, encryption and product processing, data policy (e.g. ESA's near-real-time commitment for Sentinel products is under 3 h, set by processing and policy rather than the radio), antenna slew and acquisition time (typically 1 to 2 minutes at the start of a pass), and the actual availability of relay service.");
  p("Confidence tags in the catalogue: SOURCED = operator or engineering source (listed on the card and in section 1); TYPICAL = secondary source (eoPortal, trade press), treat as +/-20 %; ASSUMED = class default. Satellite EIRP and the ground G/T are never published per mission and are always assumptions, so the margin and BER are indicative rather than a certified budget.");
  p("Payload sizes: the frog link, JPEG and H.264 figures are measured in this project's simulations (eo_satellite_sim, E8 held-out run); full product sizes from the operators (Copernicus, USGS, Maxar).");
  h2("Stations used in this report");
  table(["station", "network", "lat", "lon", "bands", "dish", "source"], r.stations.map((s) => [s.name, s.network, s.latDeg.toFixed(2), s.lonDeg.toFixed(2), s.bands.join("/"), `${s.dishM} m`, s.source]), { size: 7, widths: [30, 28, 13, 14, 14, 11, 70] });
  p(`Verification links: https://www.n2yo.com/satellite/?s=${r.details.noradId} ; https://www.heavens-above.com/PassSummary.aspx?satid=${r.details.noradId}&lat=${r.dataCentre.latDeg.toFixed(4)}&lng=${r.dataCentre.lonDeg.toFixed(4)}&alt=0&tz=UCT&showAll=t ; https://celestrak.org/NORAD/elements/gp.php?CATNR=${r.details.noradId}&FORMAT=tle`, 8, C.dim);

  // footer page numbers
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...C.dim);
    doc.text(`EO link report - ${ascii(r.sat.name)} -> ${ascii(r.dataCentre.name)} - page ${i}/${n}`, W / 2, 292, { align: "center" });
  }
  return doc;
}
