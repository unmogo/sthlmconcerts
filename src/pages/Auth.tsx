import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useToast } from "@/hooks/use-toast";
import { Music, Mail, Lock, Eye, EyeOff, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function Auth() {
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<"google" | "apple" | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const showError = (err: unknown) => {
    const message = err instanceof Error ? err.message : "Something went wrong";
    toast({ title: t("auth.errorTitle"), description: message, variant: "destructive" });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate("/");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast({ title: t("auth.checkEmail"), description: t("auth.confirmationSent") });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({ title: t("auth.resetSent"), description: t("auth.resetSentDesc") });
      }
    } catch (err) {
      showError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async () => {
    if (!email) {
      toast({ title: t("auth.errorTitle"), description: t("auth.email"), variant: "destructive" });
      return;
    }
    setMagicLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      toast({ title: t("auth.magicLinkSent"), description: t("auth.magicLinkSentDesc") });
    } catch (err) {
      showError(err);
    } finally {
      setMagicLoading(false);
    }
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setOauthLoading(provider);
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        showError(result.error);
        setOauthLoading(null);
        return;
      }
      if (result.redirected) return; // browser is redirecting
      navigate("/");
    } catch (err) {
      showError(err);
      setOauthLoading(null);
    }
  };

  const headingKey = mode === "login" ? "auth.welcomeBack" : mode === "signup" ? "auth.createAccount" : "auth.resetPassword";
  const subKey = mode === "login" ? "auth.signInToSave" : mode === "signup" ? "auth.joinToTrack" : "auth.sendResetLink";

  const pageTitle =
    mode === "login"
      ? "Sign In | STHLM Concerts"
      : mode === "signup"
      ? "Create Account | STHLM Concerts"
      : "Reset Password | STHLM Concerts";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content="Sign in to STHLM Concerts to save favourite shows in Stockholm." />
        <link rel="canonical" href="https://sthlmconcerts.lovable.app/auth" />
      </Helmet>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-neon mb-4">
            <Music className="h-7 w-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {t(headingKey)}
            <span className="sr-only"> — STHLM Concerts</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("header.tagline")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 card-shadow">
          <h2 className="text-xl font-bold text-foreground mb-1">{t(headingKey)}</h2>
          <p className="text-sm text-muted-foreground mb-6">{t(subKey)}</p>

          {/* OAuth */}
          {mode !== "forgot" && (
            <>
              <div className="space-y-2.5 mb-5">
                <button
                  type="button"
                  onClick={() => handleOAuth("google")}
                  disabled={!!oauthLoading}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <GoogleIcon />
                  {t("auth.continueWithGoogle")}
                </button>
                <button
                  type="button"
                  onClick={() => handleOAuth("apple")}
                  disabled={!!oauthLoading}
                  className="w-full inline-flex items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <AppleIcon />
                  {t("auth.continueWithApple")}
                </button>
              </div>
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">{t("auth.orWithEmail")}</span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="auth-email" className="text-sm font-medium text-foreground mb-1.5 block">{t("auth.email")}</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-input bg-background pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>

            {mode !== "forgot" && (
              <div>
                <label htmlFor="auth-password" className="text-sm font-medium text-foreground mb-1.5 block">{t("auth.password")}</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    id="auth-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={mode !== "login" || password.length > 0}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-input bg-background pl-10 pr-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {mode === "login" && (
              <div className="text-right">
                <button type="button" onClick={() => setMode("forgot")} className="text-xs text-primary hover:underline">
                  {t("auth.forgotPassword")}
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !!oauthLoading}
              className="w-full rounded-lg bg-gradient-neon py-2.5 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading
                ? t("auth.loading")
                : mode === "login"
                ? t("auth.signIn")
                : mode === "signup"
                ? t("auth.createAccountBtn")
                : t("auth.sendResetLink").includes("Send") ? "Send reset link" : t("auth.resetPassword")}
            </button>

            {mode === "login" && (
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={magicLoading || !!oauthLoading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {magicLoading ? t("auth.loading") : t("auth.magicLink")}
              </button>
            )}
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {mode === "login" ? (
              <>
                {t("auth.noAccount")}{" "}
                <button onClick={() => setMode("signup")} className="text-primary font-medium hover:underline">
                  {t("auth.signUp")}
                </button>
              </>
            ) : (
              <>
                {t("auth.haveAccount")}{" "}
                <button onClick={() => setMode("login")} className="text-primary font-medium hover:underline">
                  {t("auth.signIn")}
                </button>
              </>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-border text-center">
            <button onClick={() => navigate("/")} className="text-xs text-muted-foreground hover:text-foreground">
              {t("auth.browseWithout")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.4-1.7 4-5.5 4-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.7 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z"/>
      <path fill="#4285F4" d="M21.1 12.3c0-.6-.1-1.1-.2-1.6H12v3.9h5.5c-.2 1.2-1 2.2-2.1 2.9l3.4 2.6c2-1.8 3.2-4.6 3.2-7.8z"/>
      <path fill="#FBBC05" d="M5.5 14.2c-.2-.6-.4-1.4-.4-2.2s.1-1.5.4-2.2L2 7.2C1.2 8.6.7 10.2.7 12s.5 3.4 1.3 4.8l3.5-2.6z"/>
      <path fill="#34A853" d="M12 21.5c2.7 0 5-.9 6.6-2.4l-3.4-2.6c-.9.6-2.1 1.1-3.2 1.1-3.3 0-6-2.7-6-6 0-.8.1-1.5.4-2.2L2 6.8C1.2 8.4.7 10.1.7 12c0 5.3 4.3 9.5 11.3 9.5z"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M17.05 12.04c-.03-2.4 1.97-3.55 2.06-3.6-1.12-1.64-2.87-1.87-3.48-1.9-1.48-.15-2.89.87-3.64.87-.76 0-1.92-.85-3.16-.83-1.62.03-3.13.95-3.97 2.4-1.7 2.95-.43 7.31 1.21 9.7.81 1.18 1.76 2.5 3 2.45 1.21-.05 1.66-.78 3.12-.78s1.87.78 3.15.75c1.3-.02 2.13-1.19 2.93-2.38.92-1.36 1.3-2.69 1.32-2.76-.03-.01-2.53-.97-2.55-3.92zM14.62 4.7c.67-.81 1.12-1.94.99-3.07-.96.04-2.12.64-2.81 1.45-.62.72-1.17 1.87-1.02 2.98 1.07.08 2.17-.55 2.84-1.36z"/>
    </svg>
  );
}
