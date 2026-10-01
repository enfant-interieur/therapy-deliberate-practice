import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authClient, authErrorKey } from "../auth/client";
import { useAuthCapabilities } from "../auth/useAuthCapabilities";
import { useAppSelector } from "../store/hooks";
import { safeInternalReturnTo } from "../utils/safeReturnTo";
import { StudioArtwork } from "../components/StudioArtwork";

type Mode = "signin" | "signup";
type Provider = "google" | "github" | "apple";

export const LoginPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, authChecked } = useAppSelector(
    (state) => state.auth,
  );
  const capabilities = useAuthCapabilities();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const returnTo = safeInternalReturnTo(params.get("returnTo")) ?? "/";
  const verified = params.get("verified") === "1";
  const callbackError = params.get("authError");
  const loginURL = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;
  const verificationURL = `${loginURL}&verified=1`;
  const canSubmit = Boolean(
    capabilities?.emailPassword &&
    (mode === "signin" || capabilities.emailDelivery),
  );

  useEffect(() => {
    if (authChecked && isAuthenticated)
      navigate(returnTo.startsWith("/login") ? "/" : returnTo, {
        replace: true,
      });
  }, [authChecked, isAuthenticated, navigate, returnTo]);

  const perform = async (
    action: string,
    operation: () => Promise<{ error: { code?: string } | null }>,
    success?: string,
  ) => {
    setError(null);
    setInfo(null);
    setBusy(action);
    try {
      const result = await operation();
      if (result.error) setError(t(authErrorKey(result.error.code)));
      else if (success) setInfo(t(success));
    } catch {
      setError(t("auth.errors.unavailable"));
    } finally {
      setBusy(null);
    }
  };

  const handleEmailSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setError(t("login.errors.missingEmailPassword"));
      return;
    }
    if (mode === "signup" && password.length < 12) {
      setError(t("login.errors.passwordShort"));
      return;
    }
    if (mode === "signup" && password !== confirm) {
      setError(t("login.errors.passwordMismatch"));
      return;
    }
    void perform(
      mode,
      () =>
        mode === "signin"
          ? authClient.signIn.email({ email: cleanEmail, password })
          : authClient.signUp.email({
              email: cleanEmail,
              password,
              name: cleanEmail.split("@")[0],
              callbackURL: verificationURL,
            }),
      mode === "signup" ? "login.info.checkEmail" : undefined,
    );
  };

  const handleRecovery = (action: "reset" | "resend") => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError(
        t(
          action === "reset"
            ? "login.errors.missingEmailReset"
            : "login.errors.missingEmailResend",
        ),
      );
      return;
    }
    void perform(
      action,
      () =>
        action === "reset"
          ? authClient.requestPasswordReset({
              email: cleanEmail,
              redirectTo: `${window.location.origin}/reset-password`,
            })
          : authClient.sendVerificationEmail({
              email: cleanEmail,
              callbackURL: verificationURL,
            }),
      action === "reset"
        ? "login.info.resetEmailSent"
        : "login.info.confirmationResent",
    );
  };

  const handleOAuth = (provider: Provider) => {
    void perform(provider, () =>
      authClient.signIn.social({
        provider,
        callbackURL: loginURL,
        errorCallbackURL: `${loginURL}&authError=failed`,
      }),
    );
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="studio-hero studio-hero--split">
        <div className="studio-hero-intro">
          <div className="studio-hero-copy">
            <p className="studio-eyebrow">{t("login.welcome")}</p>
            <h1 className="studio-heading mt-3 text-3xl sm:text-4xl">
              {mode === "signin"
                ? t("login.signInTitle")
                : t("login.signUpTitle")}
            </h1>
            <p className="mt-4 text-sm text-slate-300">
              {t("auth.introduction")}
            </p>
          </div>
          <StudioArtwork
            scene="shelter"
            className="studio-library-art"
            priority
            sizes="(max-width: 767px) calc(100vw - 80px), 480px"
          />
        </div>
      </section>
      <section
        className="studio-card mx-auto max-w-xl rounded-3xl p-6 sm:p-8"
        aria-label={t("login.signInTitle")}
      >
        <div className="flex flex-wrap gap-2">
          {(["signin", "signup"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              disabled={Boolean(busy)}
              className={mode === value ? "studio-primary" : "studio-secondary"}
              onClick={() => {
                setMode(value);
                setError(null);
                setInfo(null);
              }}
            >
              {t(
                value === "signin" ? "login.mode.signIn" : "login.mode.signUp",
              )}
            </button>
          ))}
        </div>
        {(error || callbackError) && (
          <p role="alert" className="mt-5 text-sm text-rose-300">
            {error ??
              t(
                callbackError === "denied"
                  ? "auth.errors.denied"
                  : "auth.errors.callback",
              )}
          </p>
        )}
        {(info || verified) && (
          <p role="status" className="mt-5 text-sm text-teal-200">
            {info ?? t("auth.verified")}
          </p>
        )}
        {!capabilities?.ready && (
          <p role="status" className="mt-5 text-sm text-slate-300">
            {t("auth.availability")}
          </p>
        )}
        {capabilities?.ready && !capabilities.emailDelivery && (
          <p className="mt-5 text-sm text-slate-300">
            {t("auth.emailUnavailable")}
          </p>
        )}
        <form className="mt-6 space-y-4" onSubmit={handleEmailSubmit}>
          <label className="block text-sm font-medium text-slate-200">
            {t("login.placeholders.email")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              required
            />
          </label>
          <label className="block text-sm font-medium text-slate-200">
            {t("login.placeholders.password")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
              type="password"
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === "signup" ? 12 : undefined}
              maxLength={128}
              required
            />
          </label>
          {mode === "signup" && (
            <>
              <p className="text-xs text-slate-400">{t("auth.passwordHint")}</p>
              <label className="block text-sm font-medium text-slate-200">
                {t("login.placeholders.confirmPassword")}
                <input
                  className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
            </>
          )}
          <button
            className="studio-primary w-full"
            disabled={!canSubmit || Boolean(busy)}
            type="submit"
          >
            {t(
              busy === mode
                ? mode === "signin"
                  ? "login.actions.signingIn"
                  : "login.actions.creatingAccount"
                : mode === "signin"
                  ? "login.actions.primarySignIn"
                  : "login.actions.primarySignUp",
            )}
          </button>
        </form>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            className="studio-secondary text-sm"
            type="button"
            disabled={!capabilities?.emailDelivery || Boolean(busy)}
            onClick={() => handleRecovery("reset")}
          >
            {t(
              busy === "reset"
                ? "login.actions.resettingPassword"
                : "login.actions.resetPassword",
            )}
          </button>
          <button
            className="studio-secondary text-sm"
            type="button"
            disabled={!capabilities?.emailDelivery || Boolean(busy)}
            onClick={() => handleRecovery("resend")}
          >
            {t(
              busy === "resend"
                ? "login.actions.resendingConfirmation"
                : "login.actions.resendConfirmation",
            )}
          </button>
        </div>
        <p className="my-6 text-center text-sm text-slate-400">
          {t("login.actions.or")}
        </p>
        <div className="grid gap-3">
          {(["google", "github", "apple"] as const).map((provider) => (
            <button
              className="studio-secondary w-full"
              key={provider}
              type="button"
              disabled={
                !capabilities?.ready ||
                !capabilities.providers[provider] ||
                Boolean(busy)
              }
              onClick={() => handleOAuth(provider)}
            >
              {t(
                `login.oauth.${provider}${busy === provider ? "Loading" : ""}`,
              )}
              {capabilities?.ready && !capabilities.providers[provider] && (
                <span className="ml-2 text-xs font-normal">
                  {t("auth.notConfigured")}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
};
