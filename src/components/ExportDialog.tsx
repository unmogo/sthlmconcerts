import { useState } from "react";
import { format } from "date-fns";
import { Download, X, FileJson, FileSpreadsheet, Image } from "lucide-react";
import type { Concert } from "@/types/concert";
import { exportConcertsToCSV, exportConcertsToJSON, downloadFile } from "@/lib/api/concerts";

interface ExportDialogProps {
  concerts: Concert[];
  onClose: () => void;
}

export function ExportDialog({ concerts, onClose }: ExportDialogProps) {
  const [generating, setGenerating] = useState(false);

  const handleCSV = () => {
    const csv = exportConcertsToCSV(concerts);
    downloadFile(csv, `sthlm-concerts-${format(new Date(), "yyyy-MM-dd")}.csv`, "text/csv");
  };

  const handleJSON = () => {
    const json = exportConcertsToJSON(concerts);
    downloadFile(json, `sthlm-concerts-${format(new Date(), "yyyy-MM-dd")}.json`, "application/json");
  };

  const handleInstagramExport = () => {
    // Generate a detailed markdown with all info needed for Instagram posts
    const lines = concerts.map((c, i) => {
      const dt = new Date(c.date);
      return `## ${i + 1}. ${c.artist}
- **Venue:** ${c.venue}
- **Date:** ${format(dt, "EEEE d MMMM yyyy, HH:mm")}
- **Tickets:** ${c.tickets_available ? "ON SALE" : "Not yet"} ${c.ticket_url ? `→ ${c.ticket_url}` : ""}
- **Image:** ${c.image_url || "Need to find artist image"}
---`;
    });

    const md = `# Stockholm Concerts - Instagram Post Guide
Generated: ${format(new Date(), "yyyy-MM-dd HH:mm")}
Total posts needed: ${concerts.length}

## Workflow:
1. Download this file
2. For each concert below, create an Instagram post
3. Use the artist image (or search for one)
4. Caption template: "🎵 ARTIST @ VENUE\\n📅 DATE\\n🎟️ Tickets: LINK\\n\\n#stockholmconcerts #livemusic #stockholm"

---

${lines.join("\n\n")}`;

    downloadFile(md, `instagram-posts-${format(new Date(), "yyyy-MM-dd")}.md`, "text/markdown");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 card-shadow"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-foreground">Export Concerts</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          {concerts.length} concerts ready to export
        </p>

        <div className="space-y-3">
          <button
            onClick={handleInstagramExport}
            className="flex w-full items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 p-4 text-left transition-colors hover:bg-primary/20"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-neon">
              <Image className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Instagram Post Guide</p>
              <p className="text-xs text-muted-foreground">
                Markdown file with all concert details + caption templates
              </p>
            </div>
          </button>

          <button
            onClick={handleCSV}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-accent/30 hover:bg-accent/5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
              <FileSpreadsheet className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="font-semibold text-foreground">CSV Spreadsheet</p>
              <p className="text-xs text-muted-foreground">
                Open in Excel/Google Sheets for bulk editing
              </p>
            </div>
          </button>

          <button
            onClick={handleJSON}
            className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:border-neon-purple/30 hover:bg-neon-purple/5"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neon-purple/20">
              <FileJson className="h-5 w-5 text-neon-purple" />
            </div>
            <div>
              <p className="font-semibold text-foreground">JSON Data</p>
              <p className="text-xs text-muted-foreground">
                Raw data for automation scripts
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
