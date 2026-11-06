import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * Sentinel-2 acquisition plan (ESA, published weekly, 10-18 day horizon):
 * https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans
 * We scrape the page for the latest KML of the requested satellite and return the datatakes as JSON.
 * Each datatake: observation start/stop, duration, scene count, mode (NOBS nominal, VIC vicarious, DARK-O, SUN)
 * and timeliness style (NOBS_NOMINAL / NOBS_NRT). Server-cached 6 h; bundled snapshot (6 Nov 2026) as fallback.
 */
export const revalidate = 21600;

export interface Datatake { id: string; start: string; stop: string; durS: number; scenes: number; mode: string; style: string; orbit: number }

export function parseKml(kml: string): Datatake[] {
  const out: Datatake[] = [];
  const pm = kml.split("<Placemark>").slice(1);
  for (const p of pm) {
    const g = (k: string) => p.match(new RegExp(`<Data name="${k}">\\s*<value>([^<]*)</value>`))?.[1] ?? "";
    const style = p.match(/<styleUrl>([^<]*)<\/styleUrl>/)?.[1] ?? "";
    const start = g("ObservationTimeStart"), stop = g("ObservationTimeStop");
    if (!start || !stop) continue;
    out.push({ id: g("ID"), start, stop, durS: parseInt(g("ObservationDuration"), 10) / 1000, scenes: parseInt(g("Scenes"), 10) || 0, mode: g("Mode"), style, orbit: parseInt(g("OrbitAbsolute"), 10) || 0 });
  }
  return out;
}

export async function GET(req: Request) {
  const sat = (new URL(req.url).searchParams.get("sat") ?? "2A").toUpperCase(); // 2A | 2B | 2C
  const key = `s2${sat.slice(1).toLowerCase()}`;
  let kml: string | null = null, source = "esa-live", file = "";
  try {
    const page = await fetch("https://sentinels.copernicus.eu/copernicus/sentinel-2/acquisition-plans", { next: { revalidate: 21600 }, headers: { "User-Agent": "Mozilla/5.0 (sat-link-sim research)" } });
    if (!page.ok) throw new Error(`page ${page.status}`);
    const html = await page.text();
    const links = Array.from(new Set((html.match(new RegExp(`/documents/d/sentinel/${key}_mp_acq__kml[^"' ]*`, "gi")) ?? []))).sort();
    if (!links.length) throw new Error("no plan links");
    file = links[links.length - 1];
    const r = await fetch("https://sentinels.copernicus.eu" + file, { next: { revalidate: 21600 }, headers: { "User-Agent": "Mozilla/5.0 (sat-link-sim research)" } });
    if (!r.ok) throw new Error(`kml ${r.status}`);
    kml = await r.text();
    if (!kml.includes("<Placemark>")) throw new Error("not a plan");
  } catch {
    try { kml = await readFile(path.join(process.cwd(), "public", `${key}_plan_fallback.kml`), "utf8"); source = "bundled-snapshot"; file = `${key}_plan_fallback.kml`; } catch { kml = null; }
  }
  if (!kml) return NextResponse.json({ error: "no plan" }, { status: 502 });
  const name = kml.match(/<name>([^<]*)<\/name>/)?.[1] ?? "";
  return NextResponse.json({ sat, source, file, name, datatakes: parseKml(kml) }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
