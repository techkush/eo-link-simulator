/**
 * Earth-observation satellite catalogue: what each satellite carries and how it sends its data down.
 * Every entry says where its numbers come from.  `confidence`:
 *   "sourced" : the rate / band / frequency come from the operator or an engineering source (listed)
 *   "typical" : rate reported in secondary sources (eoPortal, trade press); treat as ±20 %
 *   "assumed" : no public figure found; the class default below is used and is labelled as an assumption
 * EIRP and the ground G/T are rarely published per satellite; the defaults are typical engineering values
 * and are always labelled "assumed" in the UI.
 */
export type Band = "X" | "Ka" | "S" | "UHF" | "optical";

export interface DownlinkSpec {
  band: Band;
  /** centre frequency, MHz */
  freqMHz: number;
  /** nominal payload data rate, Mbit/s (information rate after coding where known) */
  rateMbps: number;
  modulation: string;
  /** bits per symbol (information bits/symbol * code rate accounted in `codeRate`) */
  bitsPerSymbol: number;
  codeRate: number;
  /** required Eb/N0 (dB) for ~1e-6 BER / 1e-5 FER with this coding (CCSDS 130.1-G figures, approximate) */
  reqEbN0dB: number;
  /** satellite EIRP, dBW (assumed unless stated) */
  eirpdBW: number;
  eirpAssumed: boolean;
}

export interface Relay {
  /** which GEO relay system this satellite can use for payload data */
  system: "EDRS" | "TDRS" | "JDRS";
  rateMbps: number;
  note: string;
}

export interface CatalogEntry {
  match: RegExp;
  family: string;
  operator: string;
  sensor: string;
  resolution: string;
  swathKm: number | null;
  altitudeKm: number;
  downlink: DownlinkSpec;
  /** low-rate TT&C channel (S-band) – a semantic message can also ride here */
  ttc: { band: Band; freqMHz: number; rateMbps: number } | null;
  /** direct-broadcast channel to any receiver underneath, if the mission has one */
  directBroadcast: { freqMHz: number; rateMbps: number } | null;
  relay: Relay | null;
  /** payload data generated per day, GB (sets the default on-board backlog) and its provenance */
  dailyVolumeGB?: number;
  dailyVolumeSource?: string;
  /** maximum payload-transmitter time per orbit, minutes (power / thermal duty-cycle cap) */
  xbandDutyMinPerOrbit?: number;
  confidence: "sourced" | "typical" | "assumed";
  sources: string[];
  notes?: string;
}

// CCSDS-style required Eb/N0 (dB) ~1e-6 BER (approximate, CCSDS 130.1-G-3 & 131.0-B-5 performance curves)
const EBN0 = {
  qpsk_uncoded: 10.5,
  qpsk_conv12_rs: 2.8,
  qpsk_ldpc78: 4.1,
  qpsk_ldpc12: 1.2,
  oqpsk_ldpc78: 4.1,
  psk8_tcm23: 6.5,
  apsk16_ldpc34: 8.5,
};

const X: DownlinkSpec = {
  band: "X", freqMHz: 8200, rateMbps: 300, modulation: "QPSK", bitsPerSymbol: 2, codeRate: 0.5,
  reqEbN0dB: EBN0.qpsk_conv12_rs, eirpdBW: 20, eirpAssumed: true,
};
const S_TTC = { band: "S" as Band, freqMHz: 2250, rateMbps: 2 };

export const CATALOG: CatalogEntry[] = [
  {
    match: /^SENTINEL-1/, family: "Sentinel-1", operator: "ESA / Copernicus", sensor: "C-band SAR (C-SAR)",
    resolution: "5 m × 20 m (IW)", swathKm: 250, altitudeKm: 693,
    downlink: { band: "X", freqMHz: 8100, rateMbps: 520, modulation: "8PSK (2 × 260 Mbit/s)", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 24, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null,
    relay: { system: "EDRS", rateMbps: 1800, note: "Laser terminal to EDRS-A (9°E) / EDRS-C (31°E), Ka-band to ground (ESA)" },
    confidence: "sourced",
    sources: ["ESA Sentinel-1 mission overview: 520 Mbit/s X-band, two channels; EDRS laser 1.8 Gbit/s", "ESA EDRS SpaceDataHighway"],
  },
  {
    match: /^SENTINEL-2/, family: "Sentinel-2", operator: "ESA / Copernicus", sensor: "MSI, 13 bands 443–2190 nm",
    resolution: "10 / 20 / 60 m", swathKm: 290, altitudeKm: 786,
    downlink: { band: "X", freqMHz: 8090, rateMbps: 520, modulation: "8PSK", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 24, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null,
    relay: { system: "EDRS", rateMbps: 1800, note: "Laser terminal to EDRS; near-real-time delivery to Harwell / Weilheim / Redu gateways" },
    confidence: "sourced",
    sources: ["ESA Sentinel-2 mission: 520 Mbit/s X-band downlink, EDRS 1.8 Gbit/s", "ESA EDRS"],
  },
  {
    match: /^SENTINEL-3/, family: "Sentinel-3", operator: "ESA / EUMETSAT", sensor: "OLCI, SLSTR, SRAL altimeter",
    resolution: "300 m (OLCI)", swathKm: 1270, altitudeKm: 814,
    downlink: { band: "X", freqMHz: 8090, rateMbps: 520, modulation: "8PSK", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 24, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal Sentinel-3: X-band 520 Mbit/s"],
  },
  {
    match: /^SENTINEL-5P/, family: "Sentinel-5P", operator: "ESA / Copernicus", sensor: "TROPOMI spectrometer",
    resolution: "7 × 3.5 km", swathKm: 2600, altitudeKm: 824,
    downlink: { ...X, rateMbps: 310, modulation: "QPSK" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal Sentinel-5P: X-band 310 Mbit/s"],
  },
  {
    match: /^SENTINEL-6/, family: "Sentinel-6", operator: "ESA / NASA / EUMETSAT / NOAA", sensor: "Poseidon-4 altimeter",
    resolution: "along-track 300 m", swathKm: null, altitudeKm: 1336,
    downlink: { ...X, rateMbps: 150, modulation: "QPSK" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
    sources: ["class default (no public rate found)"],
  },
  {
    match: /^LANDSAT [89]/, family: "Landsat 8 / 9", operator: "USGS / NASA", sensor: "OLI(-2) + TIRS(-2)",
    resolution: "15 / 30 / 100 m", swathKm: 185, altitudeKm: 705,
    downlink: { band: "X", freqMHz: 8200.5, rateMbps: 384, modulation: "OQPSK, 440 Msym/s", bitsPerSymbol: 2, codeRate: 7 / 8, reqEbN0dB: EBN0.oqpsk_ldpc78, eirpdBW: 19, eirpAssumed: true },
    ttc: { band: "S", freqMHz: 2287.5, rateMbps: 0.26 }, directBroadcast: null, relay: null, confidence: "sourced",
    sources: ["USGS, 'Design and implementation of the next generation Landsat satellite communications system': X-band 8200.5 MHz, OQPSK, 384 Mbit/s, 440 Msym/s, LDPC 7/8"],
  },
  {
    match: /^TERRA$/, family: "Terra (EOS AM-1)", operator: "NASA", sensor: "MODIS, ASTER, MISR, CERES, MOPITT",
    resolution: "15 m – 1 km", swathKm: 2330, altitudeKm: 705,
    downlink: { ...X, freqMHz: 8212.5, rateMbps: 150, modulation: "QPSK" }, ttc: S_TTC,
    directBroadcast: { freqMHz: 8212.5, rateMbps: 15 },
    relay: { system: "TDRS", rateMbps: 150, note: "Ku-band science return via NASA TDRS (White Sands); primary science path" },
    confidence: "sourced",
    sources: ["NASA Direct Readout Laboratory: Terra MODIS direct broadcast X-band 15 Mbit/s", "NASA Terra: TDRSS Ku-band 150 Mbit/s science downlink (eoPortal)"],
  },
  {
    match: /^AQUA$/, family: "Aqua (EOS PM-1)", operator: "NASA", sensor: "MODIS, AIRS, AMSU, CERES",
    resolution: "250 m – 1 km", swathKm: 2330, altitudeKm: 705,
    downlink: { ...X, freqMHz: 8160, rateMbps: 150, modulation: "QPSK" }, ttc: S_TTC,
    directBroadcast: { freqMHz: 8160, rateMbps: 15 },
    relay: { system: "TDRS", rateMbps: 150, note: "Ku-band science return via TDRS" },
    confidence: "sourced",
    sources: ["NASA Aqua Direct Broadcast page: X-band 8160 MHz, 15 Mbit/s", "NASA IDD Aqua-DB"],
  },
  {
    match: /^AURA$/, family: "Aura", operator: "NASA", sensor: "OMI, MLS, TES, HIRDLS",
    resolution: "13 × 24 km (OMI)", swathKm: 2600, altitudeKm: 705,
    downlink: { ...X, rateMbps: 150 }, ttc: S_TTC, directBroadcast: null,
    relay: { system: "TDRS", rateMbps: 150, note: "TDRS Ku-band science return" }, confidence: "typical",
    sources: ["eoPortal Aura"],
  },
  {
    match: /^(SUOMI NPP|NOAA 2[01])/, family: "JPSS (Suomi NPP / NOAA-20 / NOAA-21)", operator: "NOAA / NASA", sensor: "VIIRS, CrIS, ATMS, OMPS",
    resolution: "375 / 750 m (VIIRS)", swathKm: 3000, altitudeKm: 824,
    downlink: { band: "Ka", freqMHz: 26700, rateMbps: 300, modulation: "QPSK", bitsPerSymbol: 2, codeRate: 7 / 8, reqEbN0dB: EBN0.qpsk_ldpc78, eirpdBW: 30, eirpAssumed: true },
    ttc: { band: "S", freqMHz: 2247.5, rateMbps: 0.5 },
    directBroadcast: { freqMHz: 7812, rateMbps: 15 },
    relay: null, confidence: "sourced",
    sources: ["NOAA OSPO Field Terminal Support: HRD X-band 7812 MHz, 15 Mbit/s", "SatNOGS DB / NOAA: stored mission data Ka-band 300 Mbit/s to Svalbard, Troll, McMurdo"],
    notes: "Stored mission data dumps go to Svalbard (and Troll / McMurdo) on Ka-band; the X-band HRD is a direct broadcast any station underneath can receive.",
  },
  {
    match: /^WORLDVIEW-3/, family: "WorldView-3", operator: "Maxar", sensor: "Pan + 8 MS + 8 SWIR + CAVIS",
    resolution: "0.31 m pan", swathKm: 13.1, altitudeKm: 617,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 1200, modulation: "8PSK (800 / 1200 Mbit/s)", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 28, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "sourced",
    sources: ["EUSI / Maxar WorldView-3 data sheet: X-band image downlink 800 and 1200 Mbit/s"],
  },
  {
    match: /^WORLDVIEW-[12]/, family: "WorldView-1 / 2", operator: "Maxar", sensor: "Pan (+ 8 MS on WV-2)",
    resolution: "0.46 m pan", swathKm: 16.4, altitudeKm: 770,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 800, modulation: "8PSK", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 26, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "sourced",
    sources: ["DigitalGlobe WorldView-2 data sheet: X-band 800 Mbit/s"],
  },
  {
    match: /^GEOEYE 1/, family: "GeoEye-1", operator: "Maxar", sensor: "Pan + 4 MS", resolution: "0.41 m pan", swathKm: 15.2, altitudeKm: 681,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 740, modulation: "8PSK", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 26, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical", sources: ["eoPortal GeoEye-1: X-band 740 Mbit/s"],
  },
  {
    match: /^LEGION/, family: "WorldView Legion", operator: "Maxar", sensor: "Pan + 8 MS", resolution: "0.29 m pan", swathKm: 9, altitudeKm: 518,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 1200, modulation: "8PSK", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 28, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed", sources: ["class default (WorldView-3 figures); Maxar has not published the Legion rate"],
  },
  {
    match: /^PLEIADES NEO/, family: "Pléiades Neo", operator: "Airbus", sensor: "Pan + 6 MS", resolution: "0.30 m pan", swathKm: 14, altitudeKm: 620,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 1124, modulation: "8PSK, 2 channels", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 28, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "sourced",
    sources: ["eoPortal / Apollo Mapping Pléiades Neo: X-band, 2 channels, 1,124 Mbit/s"],
  },
  {
    match: /^PLEIADES 1/, family: "Pléiades 1A / 1B", operator: "Airbus / CNES", sensor: "Pan + 4 MS", resolution: "0.5 m pan", swathKm: 20, altitudeKm: 694,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 465, modulation: "8PSK, 3 × 155 Mbit/s", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 24, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical", sources: ["eoPortal Pléiades-HR: X-band 465 Mbit/s"],
  },
  {
    match: /^SPOT [67]/, family: "SPOT 6 / 7", operator: "Airbus", sensor: "Pan + 4 MS", resolution: "1.5 m pan", swathKm: 60, altitudeKm: 694,
    downlink: { ...X, rateMbps: 300, modulation: "QPSK, 2 × 150 Mbit/s" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal SPOT-6/7: X-band 300 Mbit/s"],
  },
  {
    match: /^(TERRASAR-X|TANDEM-X)/, family: "TerraSAR-X / TanDEM-X", operator: "DLR / Airbus", sensor: "X-band SAR", resolution: "1 m (spotlight)", swathKm: 30, altitudeKm: 514,
    downlink: { ...X, rateMbps: 300, modulation: "QPSK" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal TerraSAR-X: X-band 300 Mbit/s"],
  },
  {
    match: /^(COSMO-SKYMED|CSG-)/, family: "COSMO-SkyMed (1st / 2nd gen)", operator: "ASI / Italian MoD", sensor: "X-band SAR", resolution: "1 m", swathKm: 40, altitudeKm: 620,
    downlink: { ...X, rateMbps: 310, modulation: "QPSK, 2 × 155 Mbit/s" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal COSMO-SkyMed: X-band 310 Mbit/s"],
  },
  {
    match: /^RADARSAT-2/, family: "RADARSAT-2", operator: "MDA / CSA", sensor: "C-band SAR", resolution: "1 – 100 m", swathKm: 500, altitudeKm: 798,
    downlink: { ...X, rateMbps: 210, modulation: "QPSK, 2 × 105 Mbit/s" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["eoPortal RADARSAT-2: X-band 2 × 105 Mbit/s"],
  },
  {
    match: /^ALOS-2/, family: "ALOS-2 (Daichi-2)", operator: "JAXA", sensor: "L-band SAR (PALSAR-2)", resolution: "1 – 100 m", swathKm: 350, altitudeKm: 628,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 800, modulation: "16QAM", bitsPerSymbol: 4, codeRate: 3 / 4, reqEbN0dB: EBN0.apsk16_ldpc34, eirpdBW: 26, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: { system: "JDRS", rateMbps: 278, note: "Ka-band via Japanese data relay" }, confidence: "typical",
    sources: ["eoPortal ALOS-2: X-band 800 Mbit/s direct, Ka-band 278 Mbit/s via relay"],
  },
  {
    match: /^ALOS-4/, family: "ALOS-4 (Daichi-4)", operator: "JAXA", sensor: "L-band SAR (PALSAR-3)", resolution: "3 m", swathKm: 200, altitudeKm: 628,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 3600, modulation: "16APSK", bitsPerSymbol: 4, codeRate: 3 / 4, reqEbN0dB: EBN0.apsk16_ldpc34, eirpdBW: 30, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: { system: "JDRS", rateMbps: 1800, note: "Optical relay (LUCAS) via JDRS GEO" }, confidence: "typical",
    sources: ["JAXA ALOS-4: X-band 3.6 Gbit/s, optical relay 1.8 Gbit/s"],
  },
  {
    match: /^ICEYE/, family: "ICEYE", operator: "ICEYE", sensor: "X-band SAR (microsat)", resolution: "0.25 – 1 m", swathKm: 30, altitudeKm: 560,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 500, modulation: "8PSK / 16APSK", bitsPerSymbol: 3, codeRate: 3 / 4, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 20, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["ICEYE: X-band downlink up to 500 Mbit/s (earlier generation 140 Mbit/s); KSAT network"],
  },
  {
    match: /^CAPELLA/, family: "Capella (Acadia)", operator: "Capella Space", sensor: "X-band SAR (microsat)", resolution: "0.5 m", swathKm: 10, altitudeKm: 600,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 300, modulation: "QPSK/8PSK", bitsPerSymbol: 2, codeRate: 3 / 4, reqEbN0dB: EBN0.qpsk_ldpc78, eirpdBW: 18, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
    sources: ["AWS Ground Station: Capella X-band 8025–8400 MHz downlink; rate not published (class default 300 Mbit/s)"],
  },
  {
    match: /^FLOCK/, family: "Planet SuperDove (Flock 4)", operator: "Planet Labs", sensor: "8-band optical (PlanetScope)", resolution: "3.7 m", swathKm: 32.5, altitudeKm: 500,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 580, modulation: "QPSK/8PSK", bitsPerSymbol: 3, codeRate: 3 / 4, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 16, eirpAssumed: true },
    ttc: { band: "UHF", freqMHz: 400, rateMbps: 0.01 }, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["Planet: SuperDove X-band downlink up to 580 Mbit/s; earlier Doves 220 Mbit/s peak", "Planet radio paper (SSC19)"],
  },
  {
    match: /^SKYSAT/, family: "SkySat", operator: "Planet Labs", sensor: "Pan + MS, video", resolution: "0.5 m", swathKm: 5.5, altitudeKm: 450,
    downlink: { ...X, rateMbps: 450, eirpdBW: 18 }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
    sources: ["class default; Planet has not published the SkySat rate"],
  },
  {
    match: /^(KOMPSAT|ARIRANG)-3/, family: "KOMPSAT-3 / 3A", operator: "KARI", sensor: "Pan + 4 MS (+ IR on 3A)", resolution: "0.55 m", swathKm: 16, altitudeKm: 685,
    downlink: { band: "X", freqMHz: 8200, rateMbps: 640, modulation: "8PSK, 2 × 320", bitsPerSymbol: 3, codeRate: 2 / 3, reqEbN0dB: EBN0.psk8_tcm23, eirpdBW: 24, eirpAssumed: true },
    ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical", sources: ["eoPortal KOMPSAT-3: X-band 640 Mbit/s"],
  },
  {
    match: /^(KOMPSAT|ARIRANG)-5/, family: "KOMPSAT-5", operator: "KARI", sensor: "X-band SAR", resolution: "1 m", swathKm: 30, altitudeKm: 550,
    downlink: { ...X, rateMbps: 310 }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical", sources: ["eoPortal KOMPSAT-5: X-band 310 Mbit/s"],
  },
  {
    match: /^(CARTOSAT|RESOURCESAT|OCEANSAT|IRS-|SCATSAT|SARAL|HYSIS)/, family: "ISRO Earth observation", operator: "ISRO", sensor: "optical / scatterometer (mission-dependent)", resolution: "0.25 – 360 m", swathKm: null, altitudeKm: 600,
    downlink: { ...X, rateMbps: 210, modulation: "QPSK, 2 × 105 Mbit/s" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical",
    sources: ["ISRO / eoPortal: Cartosat-2 series X-band 2 × 105 Mbit/s"],
  },
  {
    match: /^(GAOFEN|YAOGAN|ZIYUAN|HUANJING|HAIYANG|CBERS|SHIYAN)/, family: "Chinese EO (CNSA / CAST)", operator: "CNSA / CAST / CRESDA", sensor: "optical or SAR (mission-dependent)", resolution: "0.5 – 16 m", swathKm: null, altitudeKm: 650,
    downlink: { ...X, rateMbps: 450, modulation: "QPSK, 2 × 225 (reported)" }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
    sources: ["class default; Gaofen-1 reported 2 × 225 Mbit/s X-band (eoPortal); others not published"],
  },
  {
    match: /^ICESAT-2/, family: "ICESat-2", operator: "NASA", sensor: "ATLAS photon-counting lidar", resolution: "70 cm footprint", swathKm: null, altitudeKm: 496,
    downlink: { ...X, rateMbps: 220 }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "typical", sources: ["eoPortal ICESat-2: X-band 220 Mbit/s"],
  },
  {
    match: /^(SMAP|SMOS|GPM-CORE|JASON-3|SWOT|GOSAT|BIOMASS|MICROCARB|GOKTURK|DEIMOS|THEOS|DUBAISAT|KAZEOSAT|FORMOSAT|ASNARO|VNREDSAT|RASAT|ALSAT|NEMO|CAS500|CO3D|PRSC|RESURS|SCD|TECHSAT|TUBSAT|SINAH|SRMSAT|PARS|KENT|CARBONITE|HODOYOSHI|LAPAN|PATHFINDER|KAZSTSAT|SAUDISAT|IONOSFERA|EXACTVIEW)/,
    family: "other Earth-observation / science mission", operator: "various", sensor: "mission-dependent", resolution: "—", swathKm: null, altitudeKm: 650,
    downlink: { ...X, rateMbps: 150 }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
    sources: ["class default: X-band 150 Mbit/s QPSK (no per-mission figure loaded)"],
  },
];

const VOLUMES: { match: RegExp; gb: number; src: string; duty: number }[] = [
  { match: /^SENTINEL-1/, gb: 1800, src: "derived: 25 min SAR per orbit at ~1 Gbit/s raw (ESA S-1 System Overview); X-band cap 30 min/orbit", duty: 30 },
  { match: /^SENTINEL-2/, gb: 1500, src: "eoPortal Sentinel-2: 1.5 TB/day after compression, 2.4 Tbit memory", duty: 30 },
  { match: /^SENTINEL-3/, gb: 400, src: "assumed (OLCI/SLSTR/SRAL, lower rate than S-2)", duty: 30 },
  { match: /^LANDSAT [89]/, gb: 740, src: "eoPortal Landsat-9: up to 740 scenes/day, ~1 GB each; 400 scenes/day delivered on average", duty: 30 },
  { match: /^(TERRA|AQUA|AURA)$/, gb: 200, src: "assumed: MODIS ~ 150 Mbit/s science return via TDRS", duty: 60 },
  { match: /^(SUOMI NPP|NOAA 2[01])/, gb: 400, src: "assumed: VIIRS/CrIS/ATMS stored mission data", duty: 30 },
  { match: /^(WORLDVIEW|GEOEYE|LEGION|PLEIADES|SPOT)/, gb: 800, src: "TerraWatch Space (via 'The Downlink Wall'): 500 GB - 1 TB/day for a modern imager", duty: 30 },
  { match: /^(TERRASAR|TANDEM|COSMO|CSG|RADARSAT|ALOS|ICEYE|CAPELLA|KOMPSAT-5|ARIRANG-5)/, gb: 500, src: "assumed: SAR missions, 10-25 % amplifier duty (USU SmallSat)", duty: 20 },
  { match: /^(FLOCK|SKYSAT)/, gb: 300, src: "assumed: Planet Dove class (Planet quotes 2-4 h request-to-delivery)", duty: 15 },
];
export const GENERIC: CatalogEntry = {
  match: /.*/, family: "Earth-observation satellite (CelesTrak 'resource' group)", operator: "—", sensor: "—", resolution: "—", swathKm: null, altitudeKm: 650,
  downlink: { ...X, rateMbps: 150 }, ttc: S_TTC, directBroadcast: null, relay: null, confidence: "assumed",
  sources: ["class default: X-band 150 Mbit/s QPSK"],
};

export function catalogFor(name: string): CatalogEntry {
  const base = CATALOG.find((c) => c.match.test(name)) ?? GENERIC;
  const v = VOLUMES.find((x) => x.match.test(name));
  return { ...base, dailyVolumeGB: v?.gb ?? 500, dailyVolumeSource: v?.src ?? "assumed: 500 GB/day (TerraWatch Space range 500 GB - 1 TB/day)", xbandDutyMinPerOrbit: v?.duty ?? 30 };
}

/** GEO relay satellites (longitudes from the operators). */
export const GEO_RELAYS = [
  { system: "EDRS" as const, name: "EDRS-A (on Eutelsat 9B)", lonDeg: 9, gateways: ["Harwell", "Weilheim", "Redu"], source: "ESA EDRS: EDRS-A at 9°E" },
  { system: "EDRS" as const, name: "EDRS-C", lonDeg: 31, gateways: ["Harwell", "Weilheim", "Redu"], source: "ESA EDRS: EDRS-C at 31°E" },
  { system: "TDRS" as const, name: "TDRS East (~41°W)", lonDeg: -41, gateways: ["White Sands"], source: "NASA SCaN: TDRS East at 41°W" },
  { system: "TDRS" as const, name: "TDRS West (~174°W)", lonDeg: -174, gateways: ["White Sands", "Guam"], source: "NASA SCaN: TDRS West at 174°W" },
  { system: "TDRS" as const, name: "TDRS Z (~85°E)", lonDeg: 85, gateways: ["Guam"], source: "NASA SCaN: TDRS-Z at 85°E (via Guam)" },
  { system: "JDRS" as const, name: "JDRS-1 (~90.75°E)", lonDeg: 90.75, gateways: ["Tsukuba"], source: "JAXA JDRS-1 at 90.75°E" },
];
export const GEO_ALT_KM = 35786;
