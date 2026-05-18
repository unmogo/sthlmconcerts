// Generates public/sitemap.xml from live DB.
// Runs before `vite dev` and `vite build` via predev/prebuild npm scripts.
import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://sthlmconcerts.lovable.app";
const SUPABASE_URL = "https://bdbvyayxzlyxjzeiyfwh.supabase.co";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJkYnZ5YXl4emx5eGp6ZWl5ZndoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3NDI1NTMsImV4cCI6MjA4NjMxODU1M30.t-YZy9KfEanYCfnGcTMD8MxG0386ztOrt7lqfTSoLLw";

interface Entry {
  loc: string;
  changefreq?: string;
  priority?: string;
  lastmod?: string;
}

async function fetchAllConcerts(): Promise<Array<{ slug: string | null; id: string; updated_at: string; date: string }>> {
  const now = new Date().toISOString();
  const all: Array<{ slug: string | null; id: string; updated_at: string; date: string }> = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/concerts?select=slug,id,updated_at,date&date=gte.${encodeURIComponent(now)}&order=date.asc&limit=${pageSize}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    if (!res.ok) {
      console.warn(`sitemap: concert fetch failed (${res.status}) — proceeding with static routes`);
      return all;
    }
    const chunk = (await res.json()) as typeof all;
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return all;
}

function render(entries: Entry[]) {
  const urls = entries.map((e) => {
    const parts = [
      `  <url>`,
      `    <loc>${e.loc}</loc>`,
      e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : "",
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : "",
      e.priority ? `    <priority>${e.priority}</priority>` : "",
      `  </url>`,
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
  ].join("\n");
}

async function main() {
  const entries: Entry[] = [
    { loc: `${BASE_URL}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${BASE_URL}/auth`, changefreq: "monthly", priority: "0.3" },
  ];
  try {
    const concerts = await fetchAllConcerts();
    for (const c of concerts) {
      const slug = c.slug ?? c.id;
      entries.push({
        loc: `${BASE_URL}/event/${slug}`,
        changefreq: "weekly",
        priority: "0.8",
        lastmod: c.updated_at?.slice(0, 10),
      });
    }
    console.log(`sitemap: ${concerts.length} event URLs`);
  } catch (err) {
    console.warn(`sitemap: skipping event URLs — ${(err as Error).message}`);
  }
  writeFileSync(resolve("public/sitemap.xml"), render(entries));
  console.log(`sitemap.xml written (${entries.length} entries)`);
}

main();
