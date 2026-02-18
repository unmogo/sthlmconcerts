import { useQuery } from "@tanstack/react-query";
import { fetchConcerts } from "@/lib/api/concerts";
import { ConcertCard } from "./ConcertCard";
import { Loader2, Music, Heart } from "lucide-react";
import type { Concert, EventType } from "@/types/concert";
import { useMemo } from "react";
import { useFavorites } from "@/hooks/useFavorites";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

type FilterType = EventType | "all" | "favorites";

interface ConcertGridProps {
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  filter: FilterType;
}

// Strip tour names/subtitles for grouping (e.g. "Sombr: The Tour" → "sombr")
const normalizeForGroup = (s: string) =>
  s.split(/[:\-–—|]/)[0].trim().toLowerCase();

// Deduplicate concerts: same normalized artist + venue + exact date → keep one (shortest name)
function deduplicateConcerts(concerts: Concert[]): Concert[] {
  const seen = new Map<string, Concert>();
  for (const c of concerts) {
    const dateKey = new Date(c.date).toISOString();
    const key = `${normalizeForGroup(c.artist)}|${c.venue.toLowerCase().trim()}|${dateKey}`;
    const existing = seen.get(key);
    if (!existing || c.artist.length < existing.artist.length) {
      seen.set(key, c);
    }
  }
  return [...seen.values()];
}

// Group concerts by same artist + venue (different dates only)
function groupConcerts(concerts: Concert[]): { primary: Concert; extras: Concert[] }[] {
  const deduped = deduplicateConcerts(concerts);
  const groups: Map<string, Concert[]> = new Map();

  for (const c of deduped) {
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

  const { user } = useAuth();
  const { favoriteIds } = useFavorites();
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    if (!concerts) return [];
    let filtered: Concert[];
    if (filter === "favorites") {
      filtered = concerts.filter((c) => favoriteIds.includes(c.id));
    } else if (filter === "all") {
      filtered = concerts;
    } else {
      filtered = concerts.filter((c) => c.event_type === filter);
    }
    return groupConcerts(filtered);
  }, [concerts, filter, favoriteIds]);

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

  if (filter === "favorites" && !user) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Heart className="h-12 w-12 text-primary/40" />
        <p className="text-lg font-medium">Sign in to see your favourites</p>
        <button
          onClick={() => navigate("/auth")}
          className="rounded-lg bg-gradient-neon px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (grouped.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Music className="h-12 w-12 text-primary/40" />
        <p className="text-lg font-medium">
          {filter === "favorites" ? "No favourites saved yet" : "No upcoming concerts found"}
        </p>
        <p className="text-sm">
          {filter === "favorites" ? "Click the heart on any concert to save it" : "Click Refresh to scrape the latest events"}
        </p>
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
