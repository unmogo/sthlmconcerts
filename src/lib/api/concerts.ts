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
