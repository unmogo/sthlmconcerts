import { supabase } from "@/integrations/supabase/client";
import type { Concert } from "@/types/concert";

export async function fetchConcerts(): Promise<Concert[]> {
  const { data, error } = await supabase
    .from("concerts")
    .select("*")
    .gte("date", new Date().toISOString())
    .order("date", { ascending: true });

  if (error) throw error;
  return (data as Concert[]) || [];
}

export async function triggerScrape(): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke("scrape-concerts");
  if (error) throw error;
  return data;
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

export function exportConcertsToCSV(concerts: Concert[]): string {
  const headers = ["Artist", "Venue", "Date", "Ticket URL", "Tickets Available", "Image URL", "Source"];
  const rows = concerts.map((c) => [
    c.artist,
    c.venue,
    c.date,
    c.ticket_url || "",
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
    ticket_url: c.ticket_url,
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
