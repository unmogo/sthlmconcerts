import { Header } from "@/components/Header";
import { ConcertGrid } from "@/components/ConcertGrid";
import { ExportDialog } from "@/components/ExportDialog";
import { AddConcertDialog } from "@/components/AddConcertDialog";
import { useState, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchConcerts, deleteConcerts } from "@/lib/api/concerts";
import { useToast } from "@/hooks/use-toast";
import type { EventType } from "@/types/concert";

const Index = () => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filter, setFilter] = useState<EventType | "all">("all");
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
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground">
            Upcoming <span className="text-gradient">
              {filter === "comedy" ? "Comedy Shows" : filter === "concert" ? "Concerts" : "Events"}
            </span>
          </h2>
          <p className="mt-2 text-muted-foreground">
            All upcoming {filter === "all" ? "events" : filter === "comedy" ? "comedy shows" : "concerts"} in Stockholm · Click cards to select, then delete or export
          </p>
        </div>
        <ConcertGrid selectedIds={selectedIds} onToggleSelect={handleToggleSelect} filter={filter} />
      </main>

      {showExport && <ExportDialog concerts={concerts} onClose={() => setShowExport(false)} />}
      {showAdd && <AddConcertDialog onClose={() => setShowAdd(false)} />}
    </div>
  );
};

export default Index;
