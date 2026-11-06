import type { Band } from "./catalog";

export interface GroundStation {
  id: string;
  name: string;
  network: string;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  bands: Band[];
  /** typical largest antenna diameter at the site, m (used for G/T when the user does not override) */
  dishM: number;
  source: string;
}

/** Real Earth-observation receiving stations. Coordinates: operator pages / ESA / NASA / Wikipedia (±0.05°). */
export const STATIONS: GroundStation[] = [
  { id: "svalbard", name: "Svalbard (SvalSat)", network: "KSAT", latDeg: 78.23, lonDeg: 15.39, altKm: 0.46, bands: ["S", "X", "Ka"], dishM: 13, source: "KSAT: 78°N, 160+ antennas, up to 14 passes/day for polar orbits" },
  { id: "tromso", name: "Tromsø", network: "KSAT", latDeg: 69.66, lonDeg: 18.94, altKm: 0.1, bands: ["S", "X", "Ka"], dishM: 11, source: "KSAT Tromsø" },
  { id: "troll", name: "TrollSat (Antarctica)", network: "KSAT", latDeg: -72.01, lonDeg: 2.54, altKm: 1.27, bands: ["S", "X", "Ka"], dishM: 7.3, source: "KSAT TrollSat 72°S" },
  { id: "inuvik", name: "Inuvik", network: "CSA / DLR / SSC", latDeg: 68.32, lonDeg: -133.55, altKm: 0.07, bands: ["S", "X"], dishM: 13, source: "Inuvik Satellite Station Facility" },
  { id: "kiruna", name: "Kiruna (ESTRACK)", network: "ESA", latDeg: 67.858, lonDeg: 20.967, altKm: 0.4, bands: ["S", "X"], dishM: 15, source: "ESA: KIR-2 67.858428°N 20.966880°E, S/X-band" },
  { id: "esrange", name: "Esrange (Kiruna)", network: "SSC", latDeg: 67.88, lonDeg: 21.07, altKm: 0.4, bands: ["S", "X", "Ka"], dishM: 13, source: "SSC Esrange" },
  { id: "fairbanks", name: "Fairbanks (ASF)", network: "NASA NEN", latDeg: 64.86, lonDeg: -147.85, altKm: 0.2, bands: ["S", "X"], dishM: 11, source: "Alaska Satellite Facility" },
  { id: "mcmurdo", name: "McMurdo", network: "NASA / NOAA", latDeg: -77.85, lonDeg: 166.67, altKm: 0.1, bands: ["S", "X", "Ka"], dishM: 10, source: "NASA McMurdo Ground Station" },
  { id: "neustrelitz", name: "Neustrelitz", network: "DLR", latDeg: 53.33, lonDeg: 13.07, altKm: 0.08, bands: ["S", "X"], dishM: 7.3, source: "DLR Neustrelitz" },
  { id: "matera", name: "Matera", network: "e-GEOS / ASI (Copernicus core)", latDeg: 40.649, lonDeg: 16.704, altKm: 0.53, bands: ["X"], dishM: 10, source: "Matera 40°38′57″N 16°42′15″E, Sentinel X-band core station" },
  { id: "maspalomas", name: "Maspalomas", network: "ESA / INTA", latDeg: 27.763, lonDeg: -15.634, altKm: 0.2, bands: ["S", "X"], dishM: 15, source: "ESA: 15 m antenna 27°45′46″N 15°38′02″W" },
  { id: "siouxfalls", name: "Sioux Falls (EROS)", network: "USGS Landsat", latDeg: 43.73, lonDeg: -96.62, altKm: 0.47, bands: ["S", "X"], dishM: 10, source: "USGS EROS Landsat Ground Station" },
  { id: "wallops", name: "Wallops", network: "NASA NEN", latDeg: 37.94, lonDeg: -75.47, altKm: 0.01, bands: ["S", "X"], dishM: 11, source: "NASA Wallops" },
  { id: "whitesands", name: "White Sands (TDRS gateway)", network: "NASA SN", latDeg: 32.54, lonDeg: -106.61, altKm: 1.45, bands: ["S", "Ka"], dishM: 18, source: "NASA White Sands Complex" },
  { id: "hartebeesthoek", name: "Hartebeesthoek", network: "SANSA", latDeg: -25.89, lonDeg: 27.69, altKm: 1.4, bands: ["S", "X"], dishM: 12, source: "SANSA Hartebeesthoek" },
  { id: "puntaarenas", name: "Punta Arenas", network: "SSC / KSAT / AWS", latDeg: -53.0, lonDeg: -70.85, altKm: 0.05, bands: ["S", "X"], dishM: 7.3, source: "SSC Punta Arenas; AWS Ground Station" },
  { id: "alicesprings", name: "Alice Springs", network: "Geoscience Australia", latDeg: -23.76, lonDeg: 133.88, altKm: 0.58, bands: ["S", "X"], dishM: 9, source: "GA Alice Springs (Landsat / Sentinel)" },
  { id: "dongara", name: "Dongara", network: "SSC", latDeg: -29.05, lonDeg: 115.35, altKm: 0.03, bands: ["S", "X"], dishM: 7.3, source: "SSC Western Australia Space Centre" },
  { id: "dubbo", name: "Dubbo", network: "AWS Ground Station", latDeg: -32.24, lonDeg: 148.6, altKm: 0.27, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Dubbo" },
  { id: "singapore", name: "Singapore", network: "KSAT / AWS", latDeg: 1.35, lonDeg: 103.82, altKm: 0.02, bands: ["S", "X"], dishM: 7.3, source: "KSAT Singapore; AWS Ground Station" },
  { id: "dubai", name: "Dubai", network: "KSAT", latDeg: 25.2, lonDeg: 55.3, altKm: 0.01, bands: ["S", "X"], dishM: 7.3, source: "KSAT Dubai" },
  { id: "bahrain", name: "Bahrain", network: "AWS Ground Station", latDeg: 26.0, lonDeg: 50.6, altKm: 0.01, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Bahrain" },
  { id: "mauritius", name: "Mauritius", network: "KSAT", latDeg: -20.3, lonDeg: 57.6, altKm: 0.1, bands: ["S", "X"], dishM: 7.3, source: "KSAT Mauritius" },
  { id: "hawaii", name: "Hawaii (Oahu)", network: "AWS Ground Station / NOAA", latDeg: 21.3, lonDeg: -158.0, altKm: 0.1, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Hawaii" },
  { id: "oregon", name: "Oregon", network: "AWS Ground Station", latDeg: 45.9, lonDeg: -119.3, altKm: 0.2, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Oregon" },
  { id: "ohio", name: "Ohio", network: "AWS Ground Station", latDeg: 40.4, lonDeg: -82.9, altKm: 0.3, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Ohio" },
  { id: "ireland", name: "Ireland", network: "AWS Ground Station", latDeg: 53.3, lonDeg: -6.3, altKm: 0.05, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Ireland" },
  { id: "stockholm", name: "Stockholm", network: "AWS Ground Station", latDeg: 59.3, lonDeg: 18.1, altKm: 0.03, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Stockholm" },
  { id: "seoul", name: "Seoul", network: "AWS Ground Station", latDeg: 37.5, lonDeg: 127.0, altKm: 0.05, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Seoul" },
  { id: "capetown", name: "Cape Town", network: "AWS Ground Station", latDeg: -33.9, lonDeg: 18.4, altKm: 0.02, bands: ["S", "X"], dishM: 5.4, source: "AWS Ground Station Cape Town" },
  { id: "princealbert", name: "Prince Albert", network: "CSA / NRCan", latDeg: 53.21, lonDeg: -105.93, altKm: 0.5, bands: ["S", "X"], dishM: 10, source: "Prince Albert Satellite Station" },
  { id: "gatineau", name: "Gatineau", network: "NRCan", latDeg: 45.58, lonDeg: -75.81, altKm: 0.1, bands: ["S", "X"], dishM: 10, source: "Gatineau Satellite Station" },
  { id: "shadnagar", name: "Shadnagar (NRSC)", network: "ISRO", latDeg: 17.03, lonDeg: 78.18, altKm: 0.6, bands: ["S", "X"], dishM: 10, source: "ISRO NRSC Shadnagar" },
  { id: "hatoyama", name: "Hatoyama (EOC)", network: "JAXA", latDeg: 36.0, lonDeg: 139.35, altKm: 0.1, bands: ["S", "X"], dishM: 10, source: "JAXA Earth Observation Center" },
  { id: "miyun", name: "Miyun", network: "CRESDA / RADI", latDeg: 40.4, lonDeg: 116.9, altKm: 0.1, bands: ["S", "X"], dishM: 12, source: "RADI Miyun station" },
  { id: "kashi", name: "Kashi", network: "CRESDA / RADI", latDeg: 39.5, lonDeg: 76.0, altKm: 1.3, bands: ["S", "X"], dishM: 12, source: "RADI Kashi station" },
  { id: "sanya", name: "Sanya", network: "CRESDA / RADI", latDeg: 18.3, lonDeg: 109.3, altKm: 0.05, bands: ["S", "X"], dishM: 12, source: "RADI Sanya station" },
  { id: "cuiaba", name: "Cuiabá", network: "INPE", latDeg: -15.55, lonDeg: -56.07, altKm: 0.2, bands: ["S", "X"], dishM: 11, source: "INPE Cuiabá" },
  { id: "cordoba", name: "Córdoba", network: "CONAE", latDeg: -31.52, lonDeg: -64.46, altKm: 0.7, bands: ["S", "X"], dishM: 7.3, source: "CONAE Córdoba" },
  { id: "toulouse", name: "Toulouse (Aussaguel)", network: "CNES", latDeg: 43.43, lonDeg: 1.5, altKm: 0.2, bands: ["S", "X"], dishM: 10, source: "CNES Aussaguel" },
  { id: "harwell", name: "Harwell (EDRS gateway)", network: "ESA EDRS", latDeg: 51.57, lonDeg: -1.31, altKm: 0.1, bands: ["Ka"], dishM: 7, source: "ESA EDRS ground segment: Harwell" },
  { id: "weilheim", name: "Weilheim (EDRS gateway)", network: "DLR / EDRS", latDeg: 47.88, lonDeg: 11.08, altKm: 0.6, bands: ["Ka", "S"], dishM: 15, source: "DLR Weilheim; EDRS gateway" },
  { id: "redu", name: "Redu (EDRS gateway)", network: "ESA", latDeg: 50.0, lonDeg: 5.15, altKm: 0.4, bands: ["Ka", "S"], dishM: 15, source: "ESA Redu; EDRS gateway" },
  { id: "guam", name: "Guam (TDRS gateway)", network: "NASA SN", latDeg: 13.6, lonDeg: 144.84, altKm: 0.1, bands: ["Ka", "S"], dishM: 11, source: "NASA Guam Remote Ground Terminal" },
  { id: "tsukuba", name: "Tsukuba (JDRS gateway)", network: "JAXA", latDeg: 36.07, lonDeg: 140.13, altKm: 0.03, bands: ["Ka", "S"], dishM: 10, source: "JAXA Tsukuba Space Center" },
];

export interface DataCentre {
  id: string;
  name: string;
  latDeg: number;
  lonDeg: number;
  note: string;
}

/** Places a user might want the data delivered to (processing / data centres and cities). */
export const DATA_CENTRES: DataCentre[] = [
  { id: "glasgow", name: "Glasgow (Strathclyde)", latDeg: 55.86, lonDeg: -4.24, note: "the user's lab" },
  { id: "newyork", name: "New York", latDeg: 40.71, lonDeg: -74.01, note: "" },
  { id: "ashburn", name: "N. Virginia (AWS us-east-1, Ashburn)", latDeg: 39.04, lonDeg: -77.49, note: "largest cloud region" },
  { id: "frascati", name: "ESA ESRIN, Frascati", latDeg: 41.81, lonDeg: 12.67, note: "Copernicus / ESA Earth-observation centre" },
  { id: "darmstadt", name: "EUMETSAT, Darmstadt", latDeg: 49.87, lonDeg: 8.65, note: "Sentinel-3/6 marine processing" },
  { id: "frankfurt", name: "Frankfurt (AWS eu-central-1)", latDeg: 50.11, lonDeg: 8.68, note: "" },
  { id: "dublin", name: "Dublin (AWS eu-west-1)", latDeg: 53.35, lonDeg: -6.26, note: "" },
  { id: "eros", name: "USGS EROS, Sioux Falls", latDeg: 43.73, lonDeg: -96.62, note: "Landsat archive and processing" },
  { id: "suitland", name: "NOAA NSOF, Suitland MD", latDeg: 38.85, lonDeg: -76.94, note: "JPSS operations" },
  { id: "london", name: "London", latDeg: 51.51, lonDeg: -0.13, note: "" },
  { id: "tokyo", name: "Tokyo", latDeg: 35.68, lonDeg: 139.69, note: "" },
  { id: "singapore_dc", name: "Singapore", latDeg: 1.29, lonDeg: 103.85, note: "" },
  { id: "sydney", name: "Sydney", latDeg: -33.87, lonDeg: 151.21, note: "" },
  { id: "saopaulo", name: "São Paulo", latDeg: -23.55, lonDeg: -46.63, note: "" },
  { id: "nairobi", name: "Nairobi", latDeg: -1.29, lonDeg: 36.82, note: "" },
  { id: "mumbai", name: "Mumbai", latDeg: 19.08, lonDeg: 72.88, note: "" },
  { id: "dubai_dc", name: "Dubai", latDeg: 25.2, lonDeg: 55.27, note: "" },
  { id: "beijing", name: "Beijing", latDeg: 39.9, lonDeg: 116.4, note: "" },
  { id: "colombo", name: "Colombo", latDeg: 6.93, lonDeg: 79.86, note: "" },
  { id: "losangeles", name: "Los Angeles", latDeg: 34.05, lonDeg: -118.24, note: "" },
];

/** Example event / target locations (where the observation happens). */
export const TARGETS = [
  { id: "none", name: "(none – just the downlink)", latDeg: 0, lonDeg: 0 },
  { id: "gulf", name: "Persian Gulf coast, Iran (27.2N 56.3E)", latDeg: 27.2, lonDeg: 56.3 },
  { id: "amazon", name: "Amazon, Pará (fire season)", latDeg: -6.5, lonDeg: -53.0 },
  { id: "bangladesh", name: "Bangladesh delta (flood)", latDeg: 23.0, lonDeg: 90.0 },
  { id: "california", name: "California, Sierra foothills (fire)", latDeg: 38.8, lonDeg: -120.9 },
  { id: "athens", name: "Attica, Greece (fire)", latDeg: 38.1, lonDeg: 23.8 },
  { id: "scotland", name: "Scottish Highlands", latDeg: 57.1, lonDeg: -4.7 },
  { id: "redsea", name: "Bab-el-Mandeb strait (ships)", latDeg: 12.6, lonDeg: 43.3 },
];
