import { supabase } from "@/integrations/supabase/client";
import type { Concert } from "@/types/concert";
import { getTicketLink } from "@/lib/utils/concert-utils";

export async function fetchConcerts(): Promise<Concert[]> {
  const pageSize = 1000;
  const all: Concert[] = [];
  const fromDate = new Date().toISOString();

  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const { data, error } = await supabase
      .from("concerts")
      .select("*")
      .gte("date", fromDate)
      .order("date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw error;
    const chunk = (data as Concert[]) || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return all;
}

type JobStartResponse = { jobId: string; status: string };

async function startBackgroundJob(fn: "scrape-concerts" | "fetch-images"): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke<JobStartResponse>(fn, { body: {} });
  if (error) throw error;
  if (!data?.jobId) throw new Error("No jobId returned");
  return {
    success: true,
    message: `Job started in background. Open Logs to follow progress.`,
  };
}

export async function triggerScrape() {
  return startBackgroundJob("scrape-concerts");
}

export async function triggerFetchImages() {
  return startBackgroundJob("fetch-images");
}

export async function triggerResolveTickets(): Promise<{ success: boolean; message: string }> {
  // Keeps the existing cursor pattern — fast and reliable.
  let cursorId: string | null = null;
  let processed = 0, updated = 0, unresolved = 0;
  for (let i = 0; i < 250; i++) {
    const { data, error } = await supabase.functions.invoke("resolve-tickets", {
      body: { chain: false, batchSize: 40, cursorId },
    });
    if (error) throw error;
    const r = (data || {}) as { processed?: number; updated?: number; unresolved?: number; nextCursorId?: string | null };
    processed += r.processed ?? 0;
    updated += r.updated ?? 0;
    unresolved += r.unresolved ?? 0;
    const next = typeof r.nextCursorId === "string" && r.nextCursorId ? r.nextCursorId : null;
    if (!next) {
      return { success: true, message: `Done: processed ${processed}, updated ${updated}, unresolved ${unresolved}` };
    }
    cursorId = next;
  }
  throw new Error("resolve-tickets exceeded iteration limit");
}

export async function deleteConcerts(ids: string[]): Promise<void> {
  const { error } = await supabase.functions.invoke("manage-concerts", {
    body: { action: "delete", ids },
  });
  if (error) throw error;
}

export async function updateConcert(id: string, updates: Partial<Concert>): Promise<void> {
  const { error } = await supabase.functions.invoke("manage-concerts", {
    body: { action: "update", id, updates },
  });
  if (error) throw error;
}

export async function addConcert(concert: {
  artist: string;
  venue: string;
  date: string;
  ticket_url?: string | null;
  image_url?: string | null;
  event_type?: string;
  tickets_available?: boolean;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("manage-concerts", {
    body: { action: "insert", concert },
  });
  if (error) throw error;
}

export type ScrapedConcertDraft = Partial<Pick<Concert,
  "artist" | "venue" | "date" | "ticket_url" | "image_url" | "event_type" | "tickets_available"
>>;

export async function scrapeUrl(url: string): Promise<ScrapedConcertDraft | null> {
  const { data, error } = await supabase.functions.invoke("manage-concerts", {
    body: { action: "scrape-url", url },
  });
  if (error) throw error;
  return (data?.concert as ScrapedConcertDraft | undefined) ?? null;
}

export function exportConcertsToCSV(concerts: Concert[]): string {
  const headers = ["Artist", "Venue", "Date", "Ticket URL", "Tickets Available", "Image URL", "Source"];
  const rows = concerts.map((c) => [
    c.artist,
    c.venue,
    c.date,
    getTicketLink(c.ticket_url, c.source_url) || "",
    c.tickets_available ? "Yes" : "No",
    c.image_url || "",
    c.source || "",
  ]);

  const csv = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  return csv;
}

export function exportConcertsToJSON(concerts: Concert[]): string {
  const clean = concerts.map((c) => ({
    artist: c.artist,
    venue: c.venue,
    date: c.date,
    ticket_url: getTicketLink(c.ticket_url, c.source_url),
    tickets_available: c.tickets_available,
    image_url: c.image_url,
    source: c.source,
  }));
  return JSON.stringify(clean, null, 2);
}

export function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
