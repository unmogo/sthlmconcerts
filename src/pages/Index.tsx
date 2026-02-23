import { Header } from "@/components/Header";
import { ConcertGrid } from "@/components/ConcertGrid";
import { ExportDialog } from "@/components/ExportDialog";
import { AddConcertDialog } from "@/components/AddConcertDialog";
import { useState, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchConcerts, deleteConcerts } from "@/lib/api/concerts";
import { useToast } from "@/hooks/use-toast";
import { Search } from "lucide-react";
import type { EventType } from "@/types/concert";

type FilterType = EventType | "all" | "favorites";

const Index = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<FilterType>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: concerts = [] } = useQuery({
    queryKey: ["concerts"],
    queryFn: fetchConcerts,
  });

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleDelete = async () => {
    if (selectedIds.length === 0) return;
    setDeleting(true);
    try {
      await deleteConcerts(selectedIds);
      toast({ title: "Deleted", description: `Removed ${selectedIds.length} event(s)` });
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete events.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        selectedIds={selectedIds}
        onDelete={handleDelete}
        onExport={() => setShowExport(true)}
        onAdd={() => setShowAdd(true)}
        deleting={deleting}
        filter={filter}
        onFilterChange={setFilter}
      />
      <main className="container py-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground">
              Upcoming <span className="text-gradient">
                {filter === "comedy" ? "Comedy Shows" : filter === "concert" ? "Concerts" : filter === "favorites" ? "Favourites" : "Events"}
              </span>
            </h2>
            <p className="mt-2 text-muted-foreground">
              {filter === "favorites"
                ? "Your saved concerts"
                : `All upcoming ${filter === "all" ? "events" : filter === "comedy" ? "comedy shows" : "concerts"} in Stockholm`}
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search artists or venues…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <ConcertGrid selectedIds={selectedIds} onToggleSelect={handleToggleSelect} filter={filter} searchQuery={searchQuery} />
      </main>

      {showExport && <ExportDialog concerts={concerts} onClose={() => setShowExport(false)} />}
      {showAdd && <AddConcertDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
};

export default Index;
