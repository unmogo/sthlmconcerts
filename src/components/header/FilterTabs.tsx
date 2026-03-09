import { Sparkles, Music, Laugh, Heart } from "lucide-react";
import type { FilterType } from "@/types/concert";

interface FilterTabsProps {
  filter: FilterType;
  onFilterChange: (f: FilterType) => void;
  showFavorites: boolean;
}

export function FilterTabs({ filter, onFilterChange, showFavorites }: FilterTabsProps) {
  const tabs = [
    { value: "all" as const, label: "All", icon: Sparkles },
    { value: "concert" as const, label: "Concerts", icon: Music },
    { value: "comedy" as const, label: "Comedy", icon: Laugh },
    ...(showFavorites ? [{ value: "favorites" as const, label: "Favourites", icon: Heart }] : []),
  ];

  return (
    <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
      {tabs.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          onClick={() => onFilterChange(value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            filter === value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}