import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Activity, Clock, AlertTriangle, CheckCircle2, X } from "lucide-react";

interface ScrapeLog {
  id: string;
  batch: number | null;
  source: string | null;
  events_found: number | null;
  events_upserted: number | null;
  duration_ms: number | null;
  error: string | null;
  created_at: string | null;
}

async function fetchScrapeLogs(): Promise<ScrapeLog[]> {
  const { data, error } = await supabase
    .from("scrape_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as ScrapeLog[]) || [];
}

// Group logs by scrape run (same created_at within 5min window)
function groupByRun(logs: ScrapeLog[]): { runDate: string; logs: ScrapeLog[]; totalFound: number; totalUpserted: number; totalDuration: number; hasError: boolean }[] {
  const runs: { runDate: string; logs: ScrapeLog[]; totalFound: number; totalUpserted: number; totalDuration: number; hasError: boolean }[] = [];
  let currentRun: typeof runs[0] | null = null;

  for (const log of logs) {
    if (!log.created_at) continue;
    const logTime = new Date(log.created_at).getTime();
    
    if (!currentRun || Math.abs(logTime - new Date(currentRun.runDate).getTime()) > 300_000) {
      currentRun = {
        runDate: log.created_at,
        logs: [],
        totalFound: 0,
        totalUpserted: 0,
        totalDuration: 0,
        hasError: false,
      };
      runs.push(currentRun);
    }
    
    currentRun.logs.push(log);
    currentRun.totalFound += log.events_found || 0;
    currentRun.totalUpserted += log.events_upserted || 0;
    currentRun.totalDuration += log.duration_ms || 0;
    if (log.error && !log.source?.includes("urls") && !log.source?.includes("unmapped")) {
      currentRun.hasError = true;
    }
  }

  return runs;
}

export function ScrapeLogDashboard({ onClose }: { onClose: () => void }) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["scrape-logs"],
    queryFn: fetchScrapeLogs,
  });

  const runs = logs ? groupByRun(logs) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative mx-4 max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Scrape Log</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-6">
          {isLoading ? (
            <p className="text-center text-muted-foreground">Loading logs…</p>
          ) : runs.length === 0 ? (
            <p className="text-center text-muted-foreground">No scrape history yet</p>
          ) : (
            <div className="space-y-4">
              {runs.map((run, i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {run.hasError ? (
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      <span className="text-sm font-semibold text-foreground">
                        {run.runDate ? format(new Date(run.runDate), "MMM d, yyyy HH:mm") : "Unknown"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {Math.round(run.totalDuration / 1000)}s
                    </div>
                  </div>

                  <div className="mb-3 grid grid-cols-3 gap-3">
                    <div className="rounded-md bg-background p-2 text-center">
                      <p className="text-lg font-bold text-foreground">{run.totalFound}</p>
                      <p className="text-xs text-muted-foreground">Found</p>
                    </div>
                    <div className="rounded-md bg-background p-2 text-center">
                      <p className="text-lg font-bold text-primary">{run.totalUpserted}</p>
                      <p className="text-xs text-muted-foreground">Upserted</p>
                    </div>
                    <div className="rounded-md bg-background p-2 text-center">
                      <p className="text-lg font-bold text-foreground">{run.logs.length}</p>
                      <p className="text-xs text-muted-foreground">Batches</p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {run.logs.filter(l => l.source && !l.source.includes("urls") && !l.source.includes("unmapped")).map((log) => (
                      <div key={log.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          B{log.batch} · {log.source}
                        </span>
                        <span className="font-mono text-foreground">
                          {log.events_found ?? 0}→{log.events_upserted ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
