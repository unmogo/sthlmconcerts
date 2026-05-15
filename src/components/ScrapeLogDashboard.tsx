import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Activity, Clock, AlertTriangle, CheckCircle2, X, Loader2 } from "lucide-react";

interface ScrapeJob {
  id: string;
  kind: string;
  status: string;
  current_step: string | null;
  progress: number;
  total: number;
  events_found: number;
  events_upserted: number;
  ai_calls: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

async function fetchActiveJobs(): Promise<ScrapeJob[]> {
  const { data, error } = await supabase
    .from("scrape_jobs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data as ScrapeJob[]) || [];
}

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
  const { data: jobs } = useQuery({
    queryKey: ["scrape-jobs"],
    queryFn: fetchActiveJobs,
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const { data: logs, isLoading } = useQuery({
    queryKey: ["scrape-logs"],
    queryFn: fetchScrapeLogs,
    refetchInterval: 4000,
    refetchOnWindowFocus: true,
    staleTime: 0,
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
          <button onClick={onClose} aria-label="Close scrape log" className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto p-6 space-y-4">
          {jobs && jobs.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Background jobs</h3>
              {jobs.map((j) => {
                const pct = j.total > 0 ? Math.round((j.progress / j.total) * 100) : 0;
                const running = j.status === "running" || j.status === "queued";
                return (
                  <div key={j.id} className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {running ? (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        ) : j.status === "failed" ? (
                          <AlertTriangle className="h-4 w-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        )}
                        <span className="text-sm font-semibold capitalize">{j.kind}</span>
                        <span className="text-xs text-muted-foreground">· {j.status}{j.current_step ? ` · ${j.current_step}` : ""}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{format(new Date(j.started_at), "HH:mm:ss")}</span>
                    </div>
                    {j.total > 0 && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{j.progress}/{j.total} · found {j.events_found} · saved {j.events_upserted}</span>
                      <span>AI calls: {j.ai_calls}</span>
                    </div>
                    {j.error && <p className="mt-1 text-xs text-destructive">{j.error}</p>}
                  </div>
                );
              })}
            </div>
          )}
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
