// Minimal Firecrawl v2 client.
const KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

export async function scrapeMarkdown(url: string, opts?: { waitFor?: number; timeoutMs?: number }): Promise<string> {
  const data = await scrapeFormats(url, ["markdown"], opts);
  return (data?.data?.markdown ?? data?.markdown ?? "") as string;
}

export async function scrapeHtml(url: string, opts?: { waitFor?: number; timeoutMs?: number }): Promise<string> {
  const data = await scrapeFormats(url, ["html"], opts);
  return (data?.data?.html ?? data?.html ?? "") as string;
}

async function scrapeFormats(
  url: string,
  formats: string[],
  opts?: { waitFor?: number; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  if (!KEY) throw new Error("FIRECRAWL_API_KEY missing");
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
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

