import { Trash2, Plus, Download, ImageIcon, Activity, RefreshCw, Ticket } from "lucide-react";

interface AdminControlsProps {
  selectedCount: number;
  onDelete: () => void;
  deleting: boolean;
  onAdd: () => void;
  onExport: () => void;
  onFetchImages: () => void;
  fetchingImages: boolean;
  onResolveTickets: () => void;
  resolvingTickets: boolean;
  onShowLogs: () => void;
  onScrape: () => void;
  scraping: boolean;
}

export function AdminControls({
  selectedCount,
  onDelete,
  deleting,
  onAdd,
  onExport,
  onFetchImages,
  fetchingImages,
  onResolveTickets,
  resolvingTickets,
  onShowLogs,
  onScrape,
  scraping,
}: AdminControlsProps) {
  return (
    <>
      {selectedCount > 0 && (
        <button
          onClick={onDelete}
          disabled={deleting}
          className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete {selectedCount}
        </button>
      )}

      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
      >
        <Plus className="h-4 w-4" />
        Add
      </button>

      <button
        onClick={onExport}
        className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20"
      >
        <Download className="h-4 w-4" />
        Export
      </button>

      <button
        onClick={onFetchImages}
        disabled={fetchingImages}
        className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
      >
        <ImageIcon className={`h-4 w-4 ${fetchingImages ? "animate-pulse" : ""}`} />
        {fetchingImages ? "Fetching…" : "Images"}
      </button>

      <button
        onClick={onResolveTickets}
        disabled={resolvingTickets}
        className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
      >
        <Ticket className={`h-4 w-4 ${resolvingTickets ? "animate-pulse" : ""}`} />
        {resolvingTickets ? "Resolving…" : "Tickets"}
      </button>

      <button
        onClick={onShowLogs}
        className="inline-flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/20"
      >
        <Activity className="h-4 w-4" />
        Logs
      </button>

      <button
        onClick={onScrape}
        disabled={scraping}
        className="inline-flex items-center gap-2 rounded-lg bg-gradient-neon px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${scraping ? "animate-spin" : ""}`} />
        {scraping ? "Scraping..." : "Refresh"}
      </button>
    </>
  );
}