// Minimal Firecrawl v2 client.
const KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

export async function scrapeMarkdown(url: string, opts?: { waitFor?: number }): Promise<string> {
  if (!KEY) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: opts?.waitFor,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Firecrawl ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data?.data?.markdown ?? data?.markdown ?? "") as string;
}
