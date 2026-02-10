import { format, formatDistanceToNow, isFuture } from "date-fns";
import { Calendar, MapPin, Ticket, Clock, ExternalLink, Check, Pencil } from "lucide-react";
import type { Concert } from "@/types/concert";
import { useState } from "react";
import { EditConcertDialog } from "./EditConcertDialog";

interface ConcertCardProps {
  concert: Concert;
  extraDates?: Concert[];
  index: number;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}

export function ConcertCard({ concert, extraDates = [], index, selected, onToggleSelect }: ConcertCardProps) {
  const [showEdit, setShowEdit] = useState(false);
  const concertDate = new Date(concert.date);
  const saleDate = concert.ticket_sale_date ? new Date(concert.ticket_sale_date) : null;
  const ticketsSelling = concert.tickets_available;
  const saleNotStarted = saleDate && isFuture(saleDate);
  const allDates = [concert, ...extraDates];
  const displayDates = allDates.slice(0, 2);
  const hiddenCount = allDates.length - 2;

  return (
    <div
      className={`group relative overflow-hidden rounded-xl bg-gradient-card border transition-all duration-300 card-shadow ${
        selected
          ? "border-primary/60 glow-shadow"
          : "border-border hover:border-primary/30"
      }`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Select checkbox */}
      <button
        onClick={() => onToggleSelect(concert.id)}
        className={`absolute left-3 top-3 z-20 flex h-6 w-6 items-center justify-center rounded-md border transition-all ${
          selected
            ? "border-primary bg-primary"
            : "border-muted-foreground/40 bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100"
        }`}
      >
        {selected && <Check className="h-4 w-4 text-primary-foreground" />}
      </button>

      {/* Edit button */}
      <button
        onClick={(e) => { e.stopPropagation(); setShowEdit(true); }}
        className="absolute left-3 top-11 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-muted-foreground/40 bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-all hover:bg-background/80"
      >
        <Pencil className="h-3.5 w-3.5 text-foreground" />
      </button>

      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden">
        {concert.image_url ? (
          <img
            src={concert.image_url}
            alt={concert.artist}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-neon opacity-60">
            <span className="text-6xl font-bold text-primary-foreground/80">
              {concert.artist.charAt(0)}
            </span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />

        {/* Ticket status badge */}
        <div className="absolute right-3 top-3 z-10">
          {ticketsSelling ? (
            <span className="rounded-full bg-gradient-neon px-2.5 py-1 text-xs font-bold text-primary-foreground">
              ON SALE
            </span>
          ) : saleNotStarted ? (
            <span className="rounded-full border border-accent/40 bg-accent/20 px-2.5 py-1 text-xs font-bold text-accent backdrop-blur-sm">
              SOON
            </span>
          ) : (
            <span className="rounded-full border border-muted-foreground/30 bg-muted/80 px-2.5 py-1 text-xs font-bold text-muted-foreground backdrop-blur-sm">
              TBA
            </span>
          )}
        </div>

        {/* Artist name overlay */}
        <div className="absolute bottom-3 left-3 right-3 z-10">
          <h3 className="text-xl font-bold text-foreground leading-tight">
            {concert.artist}
          </h3>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 pt-2">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
          <MapPin className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <span className="truncate">{concert.venue}</span>
        </div>

        {/* Dates - grouped, max 2 shown */}
        <div className="space-y-1 mb-3">
          {displayDates.map((d, i) => {
            const dt = new Date(d.date);
            return (
              <div key={d.id} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 text-accent/70 shrink-0" />
                <span className={i === 0 ? "text-foreground font-medium" : ""}>
                  {format(dt, "EEE d MMM yyyy · HH:mm")}
                </span>
              </div>
            );
          })}
          {hiddenCount > 0 && (
            <p className="text-xs text-accent font-medium ml-5">
              +{hiddenCount} more · {allDates.length} shows total
            </p>
          )}
        </div>

        {/* Ticket sale countdown */}
        {saleNotStarted && saleDate && (
          <div className="mb-3 flex items-center gap-2 rounded-md border border-accent/20 bg-accent/5 px-3 py-2">
            <Clock className="h-4 w-4 text-accent" />
            <div>
              <p className="text-xs text-accent font-medium">Tickets on sale {format(saleDate, "d MMM")}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(saleDate, { addSuffix: true })}
              </p>
            </div>
          </div>
        )}

        {/* Action */}
        {concert.ticket_url && (
          <a
            href={concert.ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-neon px-4 py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Ticket className="h-4 w-4" />
            {ticketsSelling ? "Get Tickets" : "More Info"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {showEdit && (
        <EditConcertDialog concert={concert} onClose={() => setShowEdit(false)} />
      )}
    </div>
  );
}
