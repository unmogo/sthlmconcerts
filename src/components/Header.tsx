import { Music, RefreshCw, Download, Trash2, Laugh, Sparkles, Plus } from "lucide-react";
import { triggerScrape } from "@/lib/api/concerts";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { EventType } from "@/types/concert";

interface HeaderProps {
  selectedIds: string[];
  onDelete: () => void;
  onExport: () => void;
  onAdd: () => void;
  deleting: boolean;
  filter: EventType | "all";
  onFilterChange: (f: EventType | "all") => void;
}

export function Header({ selectedIds, onDelete, onExport, onAdd, deleting, filter, onFilterChange }: HeaderProps) {
  const [scraping, setScraping] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleScrape = async () => {
    setScraping(true);
    try {
      const result = await triggerScrape();
      toast({
        title: "Scrape complete",
        description: result.message || "Concerts have been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
    } catch (err) {
      toast({
        title: "Scrape failed",
        description: "Could not fetch latest concerts. Try again later.",
        variant: "destructive",
      });
    } finally {
      setScraping(false);
    }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-neon">
            <Music className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              STHLM <span className="text-gradient">CONCERTS</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Every upcoming show in Stockholm
            </p>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
          {([
            { value: "all" as const, label: "All", icon: Sparkles },
            { value: "concert" as const, label: "Concerts", icon: Music },
            { value: "comedy" as const, label: "Comedy", icon: Laugh },
          ]).map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => onFilterChange(value)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                filter === value
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            <>
              <button
                onClick={onDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete {selectedIds.length}
              </button>
            </>
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
            onClick={handleScrape}
            disabled={scraping}
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-neon px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${scraping ? "animate-spin" : ""}`} />
            {scraping ? "Scraping..." : "Refresh"}
          </button>
        </div>
      </div>
    </header>
  );
}
