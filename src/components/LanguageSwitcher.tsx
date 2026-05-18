import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  const current = i18n.language?.startsWith("sv") ? "sv" : "en";

  const toggle = () => {
    void i18n.changeLanguage(current === "en" ? "sv" : "en");
  };

  return (
    <button
      onClick={toggle}
      aria-label={`Switch language to ${current === "en" ? "Swedish" : "English"}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title={current === "en" ? "Switch to Swedish" : "Switch to English"}
    >
      <Globe className="h-3.5 w-3.5" />
      {current === "en" ? "SV" : "EN"}
    </button>
  );
}
