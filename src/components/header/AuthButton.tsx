import { LogOut, LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AuthButtonProps {
  userEmail?: string;
  onSignOut: () => void;
}

export function AuthButton({ userEmail, onSignOut }: AuthButtonProps) {
  const navigate = useNavigate();

  if (userEmail) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">
          {userEmail}
        </span>
        <button
          onClick={onSignOut}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => navigate("/auth")}
      className="inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
    >
      <LogIn className="h-4 w-4" />
      Sign in
    </button>
  );
}