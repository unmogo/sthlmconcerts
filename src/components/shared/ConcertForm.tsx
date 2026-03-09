import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { scrapeUrl } from "@/lib/api/concerts";
import { Loader2, Search, Calendar, MapPin, Music, ExternalLink } from "lucide-react";
import type { Concert, EventType } from "@/types/concert";

interface ConcertFormProps {
  mode: "add" | "edit";
  initialData?: Partial<Concert>;
  onSubmit: (data: ConcertFormData) => Promise<void>;
  onClose: () => void;
}

export interface ConcertFormData {
  artist: string;
  venue: string;
  date: string;
  ticket_url: string;
  image_url: string;
  event_type: EventType;
  tickets_available: boolean;
}

export function ConcertForm({ mode, initialData, onSubmit, onClose }: ConcertFormProps) {
  const [url, setUrl] = useState("");
  const [scraping, setScraping] = useState(false);
  const [formData, setFormData] = useState<ConcertFormData>({
    artist: initialData?.artist || "",
    venue: initialData?.venue || "",
    date: initialData?.date || "",
    ticket_url: initialData?.ticket_url || "",
    image_url: initialData?.image_url || "",
    event_type: (initialData?.event_type as EventType) || "concert",
    tickets_available: initialData?.tickets_available ?? true,
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleScrapeUrl = async () => {
    if (!url.trim()) return;
    
    setScraping(true);
    try {
      const scrapedData = await scrapeUrl(url);
      if (scrapedData) {
        setFormData({
          artist: scrapedData.artist || "",
          venue: scrapedData.venue || "",
          date: scrapedData.date || "",
          ticket_url: scrapedData.ticket_url || url,
          image_url: scrapedData.image_url || "",
          event_type: scrapedData.event_type || "concert",
          tickets_available: scrapedData.tickets_available ?? true,
        });
        toast({ title: "URL scraped", description: "Concert details filled automatically" });
      } else {
        toast({
          title: "No data found",
          description: "Could not extract concert info from this URL",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Scraping failed",
        description: "Could not fetch data from URL",
        variant: "destructive",
      });
    } finally {
      setScraping(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.artist.trim() || !formData.venue.trim() || !formData.date) {
      toast({
        title: "Missing fields",
        description: "Artist, venue, and date are required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
      onClose();
    } catch (error) {
      toast({
        title: mode === "add" ? "Add failed" : "Update failed",
        description: "Could not save concert",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-border bg-background p-6 card-shadow">
        <h2 className="mb-4 text-lg font-bold text-foreground">
          {mode === "add" ? "Add Concert" : "Edit Concert"}
        </h2>

        {mode === "add" && (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3">
            <label className="block text-sm font-medium text-foreground mb-2">
              Auto-fill from URL (optional)
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/event"
                className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={handleScrapeUrl}
                disabled={scraping || !url.trim()}
                className="flex items-center gap-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Artist *</label>
            <div className="relative">
              <Music className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                required
                value={formData.artist}
                onChange={(e) => setFormData({ ...formData, artist: e.target.value })}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Artist name"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Venue *</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                required
                value={formData.venue}
                onChange={(e) => setFormData({ ...formData, venue: e.target.value })}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Venue name"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Date & Time *</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="datetime-local"
                required
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Ticket URL</label>
            <div className="relative">
              <ExternalLink className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="url"
                value={formData.ticket_url}
                onChange={(e) => setFormData({ ...formData, ticket_url: e.target.value })}
                className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="https://tickets.example.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Image URL</label>
            <input
              type="url"
              value={formData.image_url}
              onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="https://example.com/image.jpg"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1">Event Type</label>
              <select
                value={formData.event_type}
                onChange={(e) => setFormData({ ...formData, event_type: e.target.value as EventType })}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="concert">Concert</option>
                <option value="comedy">Comedy</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={formData.tickets_available}
                  onChange={(e) => setFormData({ ...formData, tickets_available: e.target.checked })}
                  className="rounded border-input"
                />
                Tickets available
              </label>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Saving..." : mode === "add" ? "Add Concert" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}