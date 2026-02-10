import { useQuery } from "@tanstack/react-query";
import { fetchConcerts } from "@/lib/api/concerts";
import { ConcertCard } from "./ConcertCard";
import { Loader2, Music } from "lucide-react";
import type { Concert, EventType } from "@/types/concert";
import { useMemo } from "react";

interface ConcertGridProps {
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  filter: EventType | "all";
}

// Strip tour names/subtitles for grouping (e.g. "Sombr: The Tour" → "sombr")
const normalizeForGroup = (s: string) =>
  s.split(/[:\-–—|]/)[0].trim().toLowerCase();

// Group concerts by same artist + venue
function groupConcerts(concerts: Concert[]): { primary: Concert; extras: Concert[] }[] {
  const groups: Map<string, Concert[]> = new Map();

  for (const c of concerts) {
    const key = `${normalizeForGroup(c.artist)}|${c.venue.toLowerCase().trim()}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(c);
  }

  const result: { primary: Concert; extras: Concert[] }[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    result.push({ primary: group[0], extras: group.slice(1) });
  }

  // Sort by first date
  result.sort((a, b) => new Date(a.primary.date).getTime() - new Date(b.primary.date).getTime());
  return result;
}

export function ConcertGrid({ selectedIds, onToggleSelect, filter }: ConcertGridProps) {
  const { data: concerts, isLoading, error } = useQuery({
    queryKey: ["concerts"],
    queryFn: fetchConcerts,
  });

  const grouped = useMemo(() => {
    if (!concerts) return [];
    const filtered = filter === "all" ? concerts : concerts.filter((c) => c.event_type === filter);
    return groupConcerts(filtered);
  }, [concerts, filter]);

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-muted-foreground">
        <Music className="h-10 w-10" />
        <p>Failed to load concerts</p>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Music className="h-12 w-12 text-primary/40" />
        <p className="text-lg font-medium">No upcoming concerts found</p>
        <p className="text-sm">Click Refresh to scrape the latest events</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {grouped.map(({ primary, extras }, i) => (
        <ConcertCard
          key={primary.id}
          concert={primary}
          extraDates={extras}
          index={i}
          selected={selectedIds.includes(primary.id)}
          onToggleSelect={onToggleSelect}
        />
      ))}
    </div>
  );
}
