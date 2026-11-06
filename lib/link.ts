/**
 * Link budget, noise, delay and delivery-time maths. All formulas are the textbook ones
 * (Sklar; CCSDS 130.1-G; ITU-R P.676 / P.838 simplified), with the assumptions printed in the UI.
 */
import type { DownlinkSpec } from "./catalog";
import { C_KM_S } from "./satellites";

export const BOLTZMANN_dBW = -228.6; // 10 log10(k)
export const K_B = 1.380649e-23;

export interface LinkInput {
  spec: DownlinkSpec;
  rangeKm: number;
  elDeg: number;
  rangeRateKmS: number;
  /** ground antenna diameter m */
  dishM: number;
  /** ground system noise temperature K (clear sky, incl. LNA) */
  tSysK: number;
  antennaEffiency: number;
  rainRateMmH: number;
  /** data rate actually used on the link, bit/s (defaults to spec rate) */
  rateBps?: number;
}

export interface LinkBudget {
  freqMHz: number;
  rateBps: number;
  fspldB: number;
  atmosdB: number;
  raindB: number;
  pointingdB: number;
  poldB: number;
  groundGaindBi: number;
  gtdBK: number;
  eirpdBW: number;
  cn0dBHz: number;
  ebn0dB: number;
  reqEbN0dB: number;
  implLossdB: number;
  margindB: number;
  /** occupied RF bandwidth, Hz (symbol rate × (1+roll-off)) */
  bwHz: number;
  symbolRate: number;
  snrdB: number;
  noisePowerdBW: number;
  noiseDensitydBWHz: number;
  rxPowerdBW: number;
  shannonBps: number;
  /** uncoded QPSK BER at this Eb/N0 (the "raw" channel) */
  berUncoded: number;
  /** coded BER estimate: 1e-9 floor above requirement, degrading steeply below it */
  berCoded: number;
  dopplerHz: number;
  propDelayMs: number;
}

export function fspl(freqMHz: number, rangeKm: number): number {
  return 32.45 + 20 * Math.log10(freqMHz) + 20 * Math.log10(rangeKm);
}

/** Gaseous absorption through the whole atmosphere at elevation (ITU-R P.676 zenith values, cosecant law). */
export function atmosLoss(freqMHz: number, elDeg: number): number {
  const f = freqMHz / 1000;
  // zenith attenuation, dB: ~0.035 at S-band, 0.05 at X-band, 0.3 at 26 GHz (dry air + 7.5 g/m3 water vapour)
  const zenith = f < 4 ? 0.035 : f < 12 ? 0.05 : f < 20 ? 0.12 : 0.3;
  const el = Math.max(elDeg, 3) * (Math.PI / 180);
  return zenith / Math.sin(el);
}

/** Rain attenuation, ITU-R P.838 specific attenuation (k, alpha) × effective path through a 3 km rain height. */
export function rainLoss(freqMHz: number, elDeg: number, rainRateMmH: number): number {
  if (rainRateMmH <= 0) return 0;
  const f = freqMHz / 1000;
  // P.838-3 horizontal-polarisation coefficients at 2, 8, 27 GHz
  const [k, a] = f < 4 ? [0.0001321, 1.1209] : f < 12 ? [0.004115, 1.3905] : [0.1724, 1.0057];
  const gamma = k * Math.pow(rainRateMmH, a); // dB/km
  const el = Math.max(elDeg, 5) * (Math.PI / 180);
  const slant = Math.min(3 / Math.sin(el), 25); // km through rain
  const reduction = 1 / (1 + 0.045 * slant * Math.cos(el)); // P.618 horizontal reduction (approx.)
  return gamma * slant * reduction;
}

export function antennaGain(dishM: number, freqMHz: number, eff: number): number {
  const lambda = 299.792458 / freqMHz; // m
  return 10 * Math.log10(eff * Math.pow((Math.PI * dishM) / lambda, 2));
}

function erfc(x: number): number {
  // Numerical Recipes complementary error function (fractional error < 1.2e-7)
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

export function computeLink(i: LinkInput): LinkBudget {
  const s = i.spec;
  const rateBps = i.rateBps ?? s.rateMbps * 1e6;
  const freqMHz = s.freqMHz;
  const fs = fspl(freqMHz, i.rangeKm);
  const atm = atmosLoss(freqMHz, i.elDeg);
  const rain = rainLoss(freqMHz, i.elDeg, i.rainRateMmH);
  const pointing = 0.5, pol = 0.3, impl = 1.5;
  const g = antennaGain(i.dishM, freqMHz, i.antennaEffiency);
  const gt = g - 10 * Math.log10(i.tSysK);
  const cn0 = s.eirpdBW + gt - fs - atm - rain - pointing - pol - BOLTZMANN_dBW;
  const ebn0 = cn0 - 10 * Math.log10(rateBps);
  const margin = ebn0 - s.reqEbN0dB - impl;
  const symbolRate = rateBps / (s.bitsPerSymbol * s.codeRate);
  const bwHz = symbolRate * 1.35;
  const noiseDensity = BOLTZMANN_dBW + 10 * Math.log10(i.tSysK);
  const noisePower = noiseDensity + 10 * Math.log10(bwHz);
  const rxPower = s.eirpdBW + g - fs - atm - rain - pointing - pol;
  const snr = rxPower - noisePower;
  const shannon = bwHz * Math.log2(1 + Math.pow(10, snr / 10));
  const ebLin = Math.pow(10, ebn0 / 10);
  const berUncoded = 0.5 * erfc(Math.sqrt(Math.max(ebLin, 0)));
  // coded: at the required Eb/N0 the FER is ~1e-5; a steep waterfall (≈1 decade per 0.3 dB) above it, cliff below
  const over = ebn0 - impl - s.reqEbN0dB;
  const berCoded = over >= 0 ? Math.max(1e-12, 1e-6 * Math.pow(10, -over / 0.3)) : Math.min(0.5, 1e-6 * Math.pow(10, -over / 0.3));
  const dopplerHz = (-i.rangeRateKmS / C_KM_S) * freqMHz * 1e6;
  return {
    freqMHz, rateBps, fspldB: fs, atmosdB: atm, raindB: rain, pointingdB: pointing, poldB: pol,
    groundGaindBi: g, gtdBK: gt, eirpdBW: s.eirpdBW, cn0dBHz: cn0, ebn0dB: ebn0, reqEbN0dB: s.reqEbN0dB,
    implLossdB: impl, margindB: margin, bwHz, symbolRate, snrdB: snr, noisePowerdBW: noisePower,
    noiseDensitydBWHz: noiseDensity, rxPowerdBW: rxPower, shannonBps: shannon, berUncoded, berCoded, dopplerHz,
    propDelayMs: (i.rangeKm / C_KM_S) * 1000,
  };
}

/** CCSDS AOS transfer frame: 1115 bytes incl. RS check symbols is the common EO frame; the semantic message pays for one whole frame unless packed. */
export const CCSDS_FRAME_BITS = 1115 * 8;

export interface PayloadTiming {
  payloadBits: number;
  channelBits: number;
  /** pure serialisation time at the link rate (information bits / rate), s */
  serialS: number;
  /** time including the minimum one-frame granularity, s */
  framedS: number;
  /** probability that at least one bit of the payload is wrong (coded link) */
  pErrorCoded: number;
  pErrorUncoded: number;
}

export function payloadTiming(bits: number, lb: LinkBudget): PayloadTiming {
  const frames = Math.max(1, Math.ceil(bits / CCSDS_FRAME_BITS));
  const channelBits = frames * CCSDS_FRAME_BITS;
  return {
    payloadBits: bits,
    channelBits,
    serialS: bits / lb.rateBps,
    framedS: channelBits / lb.rateBps,
    pErrorCoded: 1 - Math.pow(1 - lb.berCoded, bits),
    pErrorUncoded: 1 - Math.pow(1 - lb.berUncoded, bits),
  };
}

/** Terrestrial fibre: great-circle × route factor, light in glass at 2c/3, plus per-hop switching. */
export function fibreDelayMs(greatCircleKm: number, routeFactor = 1.5, hops = 12): number {
  const pathKm = greatCircleKm * routeFactor;
  return (pathKm / (C_KM_S * 0.67)) * 1000 + hops * 0.5;
}

export function fmtS(s: number): string {
  if (!Number.isFinite(s)) return "—";
  if (s < 1e-3) return `${(s * 1e6).toFixed(1)} µs`;
  if (s < 1) return `${(s * 1e3).toFixed(2)} ms`;
  if (s < 60) return `${s.toFixed(2)} s`;
  if (s < 3600) { const r = Math.round(s); return `${Math.floor(r / 60)} min ${r % 60} s`; }
  const m = Math.round(s / 60); return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function fmtBits(b: number): string {
  if (b < 1e3) return `${b.toFixed(0)} bit`;
  if (b < 1e6) return `${(b / 1e3).toFixed(1)} kbit`;
  if (b < 1e9) return `${(b / 1e6).toFixed(2)} Mbit`;
  return `${(b / 1e9).toFixed(2)} Gbit`;
}

export function fmtRate(bps: number): string {
  if (bps < 1e3) return `${bps.toFixed(0)} bit/s`;
  if (bps < 1e6) return `${(bps / 1e3).toFixed(1)} kbit/s`;
  if (bps < 1e9) return `${(bps / 1e6).toFixed(1)} Mbit/s`;
  return `${(bps / 1e9).toFixed(2)} Gbit/s`;
}

/** Payload presets: measured in this project (frog link, JPEG, H.264) and sensor-sheet figures for full products. */
export const PAYLOADS = [
  { id: "frog_alarm", name: "Frog Class-4 alarm message (event flag + region)", bits: 64, source: "FrogNet link: one alarm packet (encoder header + 5 field bits + region id)" },
  { id: "frog_frame", name: "Frog fibres, one frame (EO sim)", bits: 159, source: "eo_satellite_sim SUMMARY.md: 159 bit/frame" },
  { id: "frog_frame_cdnet", name: "Frog fibres, one frame (CDnet @25 fps)", bits: 321, source: "E8 held-out: 8 kbit/s at 25 fps → 321 bit/frame" },
  { id: "frog_5min", name: "Frog fibres, 5-min observation (300 frames)", bits: 48_000, source: "eo_satellite_sim: 0.048 Mbit" },
  { id: "frog_crops", name: "Frog fibres + evidence crops, 5 min", bits: 109_000, source: "eo_sim_relay: 109 kbit" },
  { id: "jpeg_frame", name: "JPEG q50 frame 320×240", bits: 23_418, source: "eo_satellite_sim: 23,418 bit/frame" },
  { id: "h264_frame", name: "H.264 frame, 8 kbit/frame setting", bits: 8_201, source: "eo_satellite_sim" },
  { id: "jpeg_5min", name: "JPEG q50, 5-min observation", bits: 7_026_000, source: "eo_satellite_sim: 7.026 Mbit" },
  { id: "raw_frame", name: "Raw 8-bit frame 320×240", bits: 614_400, source: "320 × 240 × 8" },
  { id: "s2_granule", name: "Sentinel-2 L1C tile (100 km², ~600 MB)", bits: 600 * 8e6, source: "Copernicus: a 100 × 100 km L1C tile is ~500–800 MB" },
  { id: "landsat_scene", name: "Landsat 8/9 L1 scene (~1 GB)", bits: 1e9 * 8, source: "USGS: ~1 GB per Level-1 scene (185 × 180 km)" },
  { id: "wv3_strip", name: "WorldView-3 pan+MS strip, 13 × 100 km (~4 GB)", bits: 4e9 * 8, source: "0.31 m pan + 1.24 m MS, 11 bit: order of 4 GB" },
  { id: "sar_scene", name: "Sentinel-1 IW SLC product (~8 GB)", bits: 8e9 * 8, source: "Copernicus: IW SLC product 7–8 GB" },
];
