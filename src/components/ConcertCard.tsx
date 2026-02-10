import { format, formatDistanceToNow, isPast, isFuture } from "date-fns";
import { Calendar, MapPin, Ticket, Clock, ExternalLink } from "lucide-react";
import type { Concert } from "@/types/concert";
import { useState } from "react";

interface ConcertCardProps {
  concert: Concert;
  index: number;
}

export function ConcertCard({ concert, index }: ConcertCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const concertDate = new Date(concert.date);
  const saleDate = concert.ticket_sale_date ? new Date(concert.ticket_sale_date) : null;
  const ticketsSelling = concert.tickets_available;
  const saleNotStarted = saleDate && isFuture(saleDate);

  return (
    <div
      className="group relative overflow-hidden rounded-lg bg-card border border-border card-shadow transition-all duration-300 hover:border-primary/40 hover:glow-shadow"
      style={{ animationDelay: `${index * 80}ms` }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-secondary">
        {concert.image_url ? (
          <img
            src={concert.image_url}
            alt={concert.artist}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-secondary to-muted">
            <span className="text-4xl font-bold text-gradient">
              {concert.artist.charAt(0)}
            </span>
          </div>
        )}

        {/* Ticket status overlay */}
        {saleNotStarted && isHovered && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/85 backdrop-blur-sm transition-opacity">
            <Clock className="mb-2 h-6 w-6 text-primary" />
            <p className="text-sm font-medium text-foreground">Tickets on sale</p>
            <p className="text-lg font-bold text-primary">
              {format(saleDate, "d MMM yyyy")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDistanceToNow(saleDate, { addSuffix: true })}
            </p>
          </div>
        )}

        {/* Date badge */}
        <div className="absolute left-3 top-3 rounded-md bg-background/80 px-2 py-1 backdrop-blur-sm">
          <p className="text-xs font-bold text-primary">
            {format(concertDate, "d MMM")}
          </p>
        </div>

        {/* Ticket status badge */}
        <div className="absolute right-3 top-3">
          {ticketsSelling ? (
            <span className="rounded-full bg-primary/90 px-2 py-0.5 text-xs font-semibold text-primary-foreground backdrop-blur-sm">
              On Sale
            </span>
          ) : saleNotStarted ? (
            <span className="rounded-full bg-secondary/90 px-2 py-0.5 text-xs font-semibold text-secondary-foreground backdrop-blur-sm">
              Coming Soon
            </span>
          ) : (
            <span className="rounded-full bg-muted/90 px-2 py-0.5 text-xs font-semibold text-muted-foreground backdrop-blur-sm">
              TBA
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="mb-1 text-lg font-bold text-foreground truncate">
          {concert.artist}
        </h3>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-2">
          <MapPin className="h-3.5 w-3.5 text-primary/70" />
          <span className="truncate">{concert.venue}</span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-3">
          <Calendar className="h-3.5 w-3.5 text-primary/70" />
          <span>{format(concertDate, "EEEE, d MMMM yyyy · HH:mm")}</span>
        </div>

        {/* Action */}
        {concert.ticket_url && (
          <a
            href={concert.ticket_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Ticket className="h-4 w-4" />
            {ticketsSelling ? "Get Tickets" : "More Info"}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
