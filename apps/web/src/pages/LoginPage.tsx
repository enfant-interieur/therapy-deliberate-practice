import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../supabase/client";
import { useAppSelector } from "../store/hooks";

type Mode = "signin" | "signup";

export const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, authChecked } = useAppSelector((state) => state.auth);

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [loadingProvider, setLoadingProvider] = useState<"google" | "github" | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const returnTo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get("returnTo");
    return value && value.startsWith("/") ? value : "/";
  }, [location.search]);

  useEffect(() => {
    const storedError = window.localStorage.getItem("authError");
    if (storedError) {
      window.localStorage.removeItem("authError");
      setError(storedError);
    }
  }, []);

  useEffect(() => {
    if (authChecked && isAuthenticated) {
      navigate(returnTo, { replace: true });
    }
  }, [authChecked, isAuthenticated, navigate, returnTo]);

  const handleOAuth = async (provider: "google" | "github") => {
    setError(null);
    setInfo(null);
    setLoadingProvider(provider);

    window.localStorage.setItem("authReturnTo", returnTo);

    const redirectTo = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo }
    });

    if (authError) {
      setError(authError.message);
      setLoadingProvider(null);
    }
  };

  const handleEmailSubmit = async () => {
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError("Enter your email and password.");
      return;
    }

    if (mode === "signup") {
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoadingEmail(true);
    try {
      window.localStorage.setItem("authReturnTo", returnTo);

      if (mode === "signin") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }
        return;
      }

      const emailRedirectTo = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo }
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      if (!data.session) {
        setInfo("Check your email to confirm your account, then come back to sign in.");
      } else {
        setInfo("Account created. Signing you in...");
      }
    } finally {
      setLoadingEmail(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Welcome</p>
        <h2 className="mt-3 text-3xl font-semibold">
          {mode === "signin" ? "Sign in to continue" : "Create your account"}
        </h2>
        <p className="mt-3 text-sm text-slate-300">
          You&apos;ll be redirected back to {returnTo} after signing in.
        </p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-8">
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === "signin" ? "bg-white text-slate-950" : "border border-white/10 text-white"
            }`}
            onClick={() => {
              setMode("signin");
              setError(null);
              setInfo(null);
            }}
            disabled={loadingEmail || loadingProvider !== null}
          >
            Email sign in
          </button>
          <button
            type="button"
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              mode === "signup" ? "bg-white text-slate-950" : "border border-white/10 text-white"
            }`}
            onClick={() => {
              setMode("signup");
              setError(null);
              setInfo(null);
            }}
            disabled={loadingEmail || loadingProvider !== null}
          >
            Email sign up
          </button>
        </div>

        <div className="mt-6 space-y-3">
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loadingEmail || loadingProvider !== null}
          />
          <input
            className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
            placeholder="Password"
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loadingEmail || loadingProvider !== null}
          />
          {mode === "signup" && (
            <input
              className="w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-2 text-sm text-slate-100"
              placeholder="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loadingEmail || loadingProvider !== null}
            />
          )}

          <button
            className="mt-2 w-full rounded-full bg-teal-400 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-300"
            onClick={handleEmailSubmit}
            disabled={loadingEmail || loadingProvider !== null}
          >
            {loadingEmail
              ? mode === "signin"
                ? "Signing in..."
                : "Creating account..."
              : mode === "signin"
                ? "Sign in with email"
                : "Create account with email"}
          </button>

          {error && <p className="text-sm text-rose-300">{error}</p>}
          {info && <p className="text-sm text-slate-300">{info}</p>}
        </div>

        <div className="my-8 flex items-center gap-4">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-xs text-slate-400">or</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <div className="space-y-4">
          <button
            className="flex w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
            onClick={() => handleOAuth("google")}
            disabled={loadingEmail || loadingProvider !== null}
          >
            {loadingProvider === "google" ? "Connecting to Google..." : "Continue with Google"}
          </button>
          <button
            className="flex w-full items-center justify-center gap-2 rounded-full border border-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/20"
            onClick={() => handleOAuth("github")}
            disabled={loadingEmail || loadingProvider !== null}
          >
            {loadingProvider === "github" ? "Connecting to GitHub..." : "Continue with GitHub"}
          </button>
        </div>
      </section>
    </div>
  );
};
