import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { addConcert, scrapeUrl } from "@/lib/api/concerts";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface AddConcertDialogProps {
  onClose: () => void;
}

export function AddConcertDialog({ onClose }: AddConcertDialogProps) {
  const [url, setUrl] = useState("");
  const [artist, setArtist] = useState("");
  const [venue, setVenue] = useState("");
  const [date, setDate] = useState("");
  const [ticketUrl, setTicketUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [eventType, setEventType] = useState("concert");
  const [scraping, setScraping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scraped, setScraped] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleScrape = async () => {
    if (!url) return;
    setScraping(true);
    try {
      const data = await scrapeUrl(url);
      if (data) {
        setArtist(data.artist || "");
        setVenue(data.venue || "");
        setDate(data.date ? data.date.slice(0, 16) : "");
        setTicketUrl(data.ticket_url || url);
        setImageUrl(data.image_url || "");
        setEventType(data.event_type || "concert");
        setScraped(true);
        toast({ title: "Scraped", description: "Review and correct the details below" });
      }
    } catch {
      toast({ title: "Scrape failed", description: "Could not extract event info. Fill in manually.", variant: "destructive" });
      setTicketUrl(url);
      setScraped(true);
    } finally {
      setScraping(false);
    }
  };

  const handleSave = async () => {
    if (!artist || !venue || !date) {
      toast({ title: "Missing fields", description: "Artist, venue, and date are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await addConcert({
        artist,
        venue,
        date: new Date(date).toISOString(),
        ticket_url: ticketUrl || null,
        image_url: imageUrl || null,
        event_type: eventType,
      });
      toast({ title: "Added", description: `${artist} added successfully` });
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to add event", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* URL scrape step */}
          <div>
            <Label htmlFor="url">Event URL (optional – paste to auto-fill)</Label>
            <div className="flex gap-2">
              <Input
                id="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.livenation.se/event/..."
              />
              <Button onClick={handleScrape} disabled={scraping || !url} variant="outline" className="shrink-0">
                {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : "Scrape"}
              </Button>
            </div>
          </div>

          {/* Editable fields */}
          <div>
            <Label htmlFor="add-artist">Artist *</Label>
            <Input id="add-artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="add-venue">Venue *</Label>
            <Input id="add-venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="add-date">Date & Time *</Label>
            <Input id="add-date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="add-type">Type</Label>
            <select
              id="add-type"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="concert">Concert</option>
              <option value="comedy">Comedy</option>
            </select>
          </div>
          <div>
            <Label htmlFor="add-ticket">Ticket URL</Label>
            <Input id="add-ticket" value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="add-image">Image URL</Label>
            <Input id="add-image" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
            {imageUrl && (
              <img src={imageUrl} alt="Preview" className="mt-2 h-24 w-full rounded-md object-cover" />
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Adding..." : "Add Event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
