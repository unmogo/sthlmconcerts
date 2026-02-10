import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { updateConcert } from "@/lib/api/concerts";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import type { Concert } from "@/types/concert";

interface EditConcertDialogProps {
  concert: Concert;
  onClose: () => void;
}

export function EditConcertDialog({ concert, onClose }: EditConcertDialogProps) {
  const [artist, setArtist] = useState(concert.artist);
  const [venue, setVenue] = useState(concert.venue);
  const [date, setDate] = useState(concert.date.slice(0, 16)); // datetime-local format
  const [ticketUrl, setTicketUrl] = useState(concert.ticket_url || "");
  const [imageUrl, setImageUrl] = useState(concert.image_url || "");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConcert(concert.id, {
        artist,
        venue,
        date: new Date(date).toISOString(),
        ticket_url: ticketUrl || null,
        image_url: imageUrl || null,
      });
      toast({ title: "Updated", description: `${artist} updated successfully` });
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
      onClose();
    } catch {
      toast({ title: "Error", description: "Failed to update", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Edit Event</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="artist">Artist</Label>
            <Input id="artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="venue">Venue</Label>
            <Input id="venue" value={venue} onChange={(e) => setVenue(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="date">Date & Time</Label>
            <Input id="date" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ticket_url">Ticket URL</Label>
            <Input id="ticket_url" value={ticketUrl} onChange={(e) => setTicketUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label htmlFor="image_url">Image URL</Label>
            <Input id="image_url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
            {imageUrl && (
              <img src={imageUrl} alt="Preview" className="mt-2 h-24 w-full rounded-md object-cover" />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
