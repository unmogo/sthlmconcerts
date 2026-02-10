import { useQuery } from "@tanstack/react-query";
import { fetchConcerts } from "@/lib/api/concerts";
import { ConcertCard } from "./ConcertCard";
import { Loader2, Music } from "lucide-react";

export function ConcertGrid() {
  const { data: concerts, isLoading, error } = useQuery({
    queryKey: ["concerts"],
    queryFn: fetchConcerts,
  });

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

  if (!concerts || concerts.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Music className="h-12 w-12 text-primary/40" />
        <p className="text-lg font-medium">No upcoming concerts found</p>
        <p className="text-sm">Run a scrape to populate the database</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {concerts.map((concert, i) => (
        <ConcertCard key={concert.id} concert={concert} index={i} />
      ))}
    </div>
  );
}
