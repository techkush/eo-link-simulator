import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

/**
 * Real orbital elements from CelesTrak.
 *  - GROUP=resource : CelesTrak's "Earth Resources" group (the Earth-observation fleet, ~170 objects)
 *  - extra objects not in that group: ICEYE, Capella, Suomi NPP, NOAA-20/21 (weather group), 8 Planet SuperDoves
 * Server-cached for 6 h (CelesTrak asks not to poll more often than every 2 h per object).
 */
const SOURCES = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?NAME=ICEYE&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?NAME=CAPELLA&FORMAT=tle",
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=37849&FORMAT=tle", // Suomi NPP
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=43013&FORMAT=tle", // NOAA-20
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=54234&FORMAT=tle", // NOAA-21
];

export const revalidate = 21600;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    next: { revalidate: 21600 },
    headers: { "User-Agent": "sat-link-sim (research, Strathclyde)" },
  });
  if (!res.ok) throw new Error(`CelesTrak ${res.status} for ${url}`);
  const t = await res.text();
  if (!t.startsWith("1 ") && !/\n1 /.test(t) && !/^[A-Z]/.test(t)) throw new Error("bad payload");
  if (t.includes("No GP data")) return "";
  return t;
}

export async function GET() {
  try {
    const parts = await Promise.all(SOURCES.map(fetchText));
    // SuperDoves: take the bundled eight (the full Flock is ~200 objects and changes weekly)
    const extra = await readFile(path.join(process.cwd(), "public", "eo-extra.txt"), "utf8");
    const doves = extra
      .split(/\r?\n/)
      .reduce<string[]>((acc, l, i, arr) => {
        if (l.startsWith("FLOCK")) acc.push(l, arr[i + 1], arr[i + 2]);
        return acc;
      }, [])
      .join("\n");
    const text = [...parts, doves].filter(Boolean).join("\n");
    if (!text.includes("SENTINEL")) throw new Error("Unexpected TLE payload");
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-TLE-Source": "celestrak-live" },
    });
  } catch {
    // Client falls back to the bundled snapshots /eo-fallback.txt + /eo-extra.txt
    return new NextResponse("TLE fetch failed", { status: 502 });
  }
}
