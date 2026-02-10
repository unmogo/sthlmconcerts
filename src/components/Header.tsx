import logo from "@/assets/logo.png";
import { Music, RefreshCw } from "lucide-react";
import { triggerScrape } from "@/lib/api/concerts";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export function Header() {
  const [scraping, setScraping] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleScrape = async () => {
    setScraping(true);
    try {
      const result = await triggerScrape();
      toast({
        title: "Scrape complete",
        description: result.message || "Concerts have been updated.",
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

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="container flex items-center justify-between py-4">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Logo" className="h-10 w-10" />
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Stockholm <span className="text-gradient">Live</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              Every upcoming concert in one place
            </p>
          </div>
        </div>

        <button
          onClick={handleScrape}
          disabled={scraping}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${scraping ? "animate-spin" : ""}`} />
          {scraping ? "Scraping..." : "Refresh Concerts"}
        </button>
      </div>
    </header>
  );
}
