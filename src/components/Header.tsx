import { Music } from "lucide-react";
import { triggerScrape, triggerFetchImages } from "@/lib/api/concerts";
import { useState } from "react";
import { ScrapeLogDashboard } from "./ScrapeLogDashboard";
import { FilterTabs } from "./header/FilterTabs";
import { AdminControls } from "./header/AdminControls";
import { AuthButton } from "./header/AuthButton";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { FilterType } from "@/types/concert";

interface HeaderProps {
  selectedIds: string[];
  onDelete: () => void;
  onExport: () => void;
  onAdd: () => void;
  deleting: boolean;
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
}

export function Header({ selectedIds, onDelete, onExport, onAdd, deleting, filter, onFilterChange }: HeaderProps) {
  const [scraping, setScraping] = useState(false);
  const [fetchingImages, setFetchingImages] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user, isAdmin, signOut } = useAuth();

  const handleScrape = async () => {
    setScraping(true);
    try {
      const result = await triggerScrape();
      toast({
        title: "Scrape started",
        description: (result.message || "Concerts are being updated.") + " Remaining batches continue in the background.",
      });
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
    } catch (err) {
      toast({
        title: "Scrape failed",
        description: "Could not fetch latest concerts. Try again later.",
        variant: "destructive",
      });
    } finally {
      setScraping(false);
    }
  };

  const handleFetchImages = async () => {
    setFetchingImages(true);
    try {
      const result = await triggerFetchImages();
      toast({
        title: "Images updated",
        description: result.message || "Missing images have been fetched.",
      });
      queryClient.invalidateQueries({ queryKey: ["concerts"] });
    } catch {
      toast({
        title: "Image fetch failed",
        description: "Could not fetch images. Try again later.",
        variant: "destructive",
      });
    } finally {
      setFetchingImages(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast({ title: "Signed out" });
  };

  return (
    <>
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-neon">
            <Music className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              STHLM <span className="text-gradient">CONCERTS</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Every upcoming show in Stockholm
            </p>
          </div>
        </div>

        <FilterTabs filter={filter} onFilterChange={onFilterChange} showFavorites={!!user} />

        <div className="flex items-center gap-2">
          {isAdmin && (
            <AdminControls
              selectedCount={selectedIds.length}
              onDelete={onDelete}
              deleting={deleting}
              onAdd={onAdd}
              onExport={onExport}
              onFetchImages={handleFetchImages}
              fetchingImages={fetchingImages}
              onShowLogs={() => setShowLogs(true)}
              onScrape={handleScrape}
              scraping={scraping}
            />
          )}

          <AuthButton userEmail={user?.email} onSignOut={handleSignOut} />
        </div>
      </div>
    </header>
    {showLogs && <ScrapeLogDashboard onClose={() => setShowLogs(false)} />}
    </>
  );
}
