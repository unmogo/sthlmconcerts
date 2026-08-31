// Minimal Firecrawl v2 client with pacing + 429 retry.
//
// The account allows ~50 scrapes/minute and it is shared across every source in
// a run. Without pacing, one greedy source (RA detail-page enrichment) burns the
// whole minute and every later source fails its very first request with a 429.
const KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

const MIN_INTERVAL_MS = 1_400; // ~42 req/min, under the 50/min ceiling
let nextSlot = 0;

async function takeSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + MIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

type ScrapeResult = { markdown?: string; html?: string; data?: { markdown?: string; html?: string } };

export async function scrapeMarkdown(url: string, opts?: { waitFor?: number; timeoutMs?: number }): Promise<string> {
  const data = await scrapeFormats(url, ["markdown"], opts) as ScrapeResult | null;
  return data?.data?.markdown ?? data?.markdown ?? "";
}

export async function scrapeHtml(url: string, opts?: { waitFor?: number; timeoutMs?: number }): Promise<string> {
  const data = await scrapeFormats(url, ["html"], opts) as ScrapeResult | null;
  return data?.data?.html ?? data?.html ?? "";
}


async function scrapeFormats(
  url: string,
  formats: string[],
  opts?: { waitFor?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  if (!KEY) throw new Error("FIRECRAWL_API_KEY missing");
  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    await takeSlot();
    // Hard timeout: an un-aborted fetch can hang forever and strand the whole job.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? 45_000);
    try {
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        signal: ctl.signal,
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          formats,
          onlyMainContent: true,
          waitFor: opts?.waitFor,
        }),
      });
      if (res.status === 429 || res.status >= 500) {
        const text = await res.text().catch(() => "");
        lastError = `Firecrawl ${res.status}: ${text.slice(0, 200)}`;
        const retryAfter = Number(res.headers.get("retry-after"));
        const bodyHint = Number(text.match(/retry after (\d+)s/i)?.[1]);
        const delay = (Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter
          : Number.isFinite(bodyHint) && bodyHint > 0
            ? bodyHint
            : 5 * (attempt + 1)) * 1000;
        // Push the shared pacing window out so parallel callers back off too.
        nextSlot = Math.max(nextSlot, Date.now() + delay);
        await new Promise((r) => setTimeout(r, delay + 500));
        continue;
      }
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
      }
      return await res.json();
    } catch (e) {
      lastError = (e as Error).message;
      if ((e as Error).name === "AbortError") continue;
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError || "Firecrawl failed after retries");
}


