import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authClient, authErrorKey } from "../auth/client";
import { useAuthCapabilities } from "../auth/useAuthCapabilities";
import { useAppSelector } from "../store/hooks";
import { safeInternalReturnTo } from "../utils/safeReturnTo";
import { AuthLayout } from "../components/AuthLayout";

type Mode = "signin" | "signup" | "reset";
type Provider = "google" | "github" | "apple";

export const LoginPage = ({ mode = "signin" }: { mode?: Mode }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, authChecked } = useAppSelector(
    (state) => state.auth,
  );
  const capabilities = useAuthCapabilities();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [sent, setSent] = useState<"verification" | "reset" | null>(null);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const returnTo = safeInternalReturnTo(params.get("returnTo")) ?? "/";
  const verified = params.get("verified") === "1";
  const callbackError = params.get("authError");
  const authPath = (path: string) =>
    returnTo === "/"
      ? path
      : `${path}?returnTo=${encodeURIComponent(returnTo)}`;
  const loginURL = `${window.location.origin}/login?returnTo=${encodeURIComponent(returnTo)}`;
  const verificationURL = `${loginURL}&verified=1`;
  const availableProviders = (["google", "github", "apple"] as const).filter(
    (provider) => capabilities?.ready && capabilities.providers[provider],
  );
  const canSubmit = Boolean(
    capabilities?.emailPassword &&
    (mode === "signin" || capabilities.emailDelivery),
  );

  useEffect(() => {
    if (authChecked && isAuthenticated)
      navigate(
        /^\/(login|signup|forgot-password)(?:[/?#]|$)/.test(returnTo)
          ? "/"
          : returnTo,
        { replace: true },
      );
  }, [authChecked, isAuthenticated, navigate, returnTo]);

  const perform = async (
    action: string,
    operation: () => Promise<{ error: { code?: string } | null }>,
    success?: () => void,
  ) => {
    if (busy) return;
    setError(null);
    setNeedsVerification(false);
    setBusy(action);
    try {
      const result = await operation();
      if (result.error) {
        setError(t(authErrorKey(result.error.code)));
        setNeedsVerification(result.error.code === "EMAIL_NOT_VERIFIED");
      } else success?.();
    } catch {
      setError(t("auth.errors.unavailable"));
    } finally {
      setBusy(null);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || (mode !== "reset" && !password)) {
      setError(
        t(
          mode === "reset"
            ? "login.errors.missingEmailReset"
            : "login.errors.missingEmailPassword",
        ),
      );
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
      () => {
        if (mode === "reset")
          return authClient.requestPasswordReset({
            email: cleanEmail,
            redirectTo: `${window.location.origin}/reset-password`,
          });
        if (mode === "signup")
          return authClient.signUp.email({
            email: cleanEmail,
            password,
            name: cleanEmail.split("@")[0],
            callbackURL: verificationURL,
          });
        return authClient.signIn.email({ email: cleanEmail, password });
      },
      () => {
        if (mode !== "signin") {
          setPassword("");
          setConfirm("");
          setSent(mode === "reset" ? "reset" : "verification");
        }
      },
    );
  };

  const resendConfirmation = () =>
    void perform(
      "resend",
      () =>
        authClient.sendVerificationEmail({
          email: email.trim().toLowerCase(),
          callbackURL: verificationURL,
        }),
      () => {
        setPassword("");
        setConfirm("");
        setSent("verification");
        setResent(true);
      },
    );

  const handleOAuth = (provider: Provider) =>
    void perform(provider, () =>
      authClient.signIn.social({
        provider,
        callbackURL: loginURL,
        errorCallbackURL: `${loginURL}&authError=failed`,
      }),
    );

  const title = sent
    ? t("auth.simple.checkInbox")
    : t(
        mode === "signin"
          ? "login.signInTitle"
          : mode === "signup"
            ? "login.signUpTitle"
            : "auth.simple.forgotTitle",
      );
  return (
    <AuthLayout
      title={title}
      introduction={sent ? undefined : t(`auth.simple.${mode}Introduction`)}
    >
      {(error || callbackError) && (
        <div
          role="alert"
          className="auth-message auth-message--error"
          id="auth-error"
        >
          {error ??
            t(
              callbackError === "denied"
                ? "auth.errors.denied"
                : "auth.errors.callback",
            )}
          {needsVerification && capabilities?.emailDelivery && (
            <button
              type="button"
              className="auth-link"
              disabled={Boolean(busy)}
              onClick={resendConfirmation}
            >
              {t(
                busy === "resend"
                  ? "login.actions.resendingConfirmation"
                  : "login.actions.resendConfirmation",
              )}
            </button>
          )}
        </div>
      )}
      {sent ? (
        <div className="auth-confirmation">
          <p role="status">
            {t(
              sent === "reset"
                ? "login.info.resetEmailSent"
                : resent
                  ? "login.info.confirmationResent"
                  : "login.info.checkEmail",
            )}
          </p>
          <Link
            className="auth-primary"
            to={authPath("/login")}
            onClick={() => {
              setSent(null);
              setResent(false);
              setError(null);
            }}
          >
            {t("auth.backToLogin")}
          </Link>
          {sent === "verification" && (
            <button
              type="button"
              className="auth-link"
              disabled={Boolean(busy)}
              onClick={resendConfirmation}
            >
              {t(
                busy === "resend"
                  ? "login.actions.resendingConfirmation"
                  : "login.actions.resendConfirmation",
              )}
            </button>
          )}
        </div>
      ) : (
        <>
          {verified && (
            <p role="status" className="auth-message auth-message--status">
              {t("auth.verified")}
            </p>
          )}
          {capabilities === undefined && (
            <p role="status" className="auth-hint">
              {t("auth.simple.loading")}
            </p>
          )}
          {capabilities !== undefined && !capabilities?.ready && (
            <p role="status" className="auth-message auth-message--status">
              {t("auth.availability")}
            </p>
          )}
          {capabilities?.ready &&
            !capabilities.emailDelivery &&
            mode !== "signin" && (
              <p role="status" className="auth-message auth-message--status">
                {t("auth.emailUnavailable")}
              </p>
            )}
          <form
            className="auth-form"
            onSubmit={handleSubmit}
            aria-busy={Boolean(busy)}
          >
            <div className="auth-field">
              <label htmlFor="auth-email">
                {t("login.placeholders.email")}
              </label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                disabled={Boolean(busy)}
                required
              />
            </div>
            {mode !== "reset" && (
              <div className="auth-field">
                <div className="auth-label-row">
                  <label htmlFor="auth-password">
                    {t("login.placeholders.password")}
                  </label>
                  {mode === "signin" && (
                    <Link
                      className="auth-link"
                      to={authPath("/forgot-password")}
                    >
                      {t("login.actions.resetPassword")}
                    </Link>
                  )}
                </div>
                <input
                  id="auth-password"
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={mode === "signup" ? 12 : undefined}
                  maxLength={128}
                  disabled={Boolean(busy)}
                  aria-describedby={
                    mode === "signup" ? "auth-password-hint" : undefined
                  }
                  required
                />
                {mode === "signup" && (
                  <p id="auth-password-hint" className="auth-hint">
                    {t("auth.passwordHint")}
                  </p>
                )}
              </div>
            )}
            {mode === "signup" && (
              <div className="auth-field">
                <label htmlFor="auth-confirm">
                  {t("login.placeholders.confirmPassword")}
                </label>
                <input
                  id="auth-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  minLength={12}
                  maxLength={128}
                  disabled={Boolean(busy)}
                  required
                />
              </div>
            )}
            <button
              className="auth-primary"
              disabled={!canSubmit || Boolean(busy)}
              type="submit"
            >
              {t(
                busy === mode
                  ? mode === "signin"
                    ? "login.actions.signingIn"
                    : mode === "signup"
                      ? "login.actions.creatingAccount"
                      : "auth.simple.sending"
                  : mode === "signin"
                    ? "login.actions.primarySignIn"
                    : mode === "signup"
                      ? "login.actions.primarySignUp"
                      : "auth.simple.sendLink",
              )}
            </button>
          </form>
          {mode !== "reset" && availableProviders.length > 0 && (
            <>
              <p className="auth-divider">{t("login.actions.or")}</p>
              <div className="auth-social">
                {availableProviders.map((provider) => (
                  <button
                    className="auth-provider"
                    key={provider}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => handleOAuth(provider)}
                  >
                    {t(
                      `login.oauth.${provider}${busy === provider ? "Loading" : ""}`,
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="auth-switch">
            {mode === "signin" && t("auth.simple.noAccount")}
            {mode === "signup" && t("auth.simple.hasAccount")}
            <Link
              className="auth-link"
              to={authPath(mode === "signin" ? "/signup" : "/login")}
            >
              {t(
                mode === "signin"
                  ? "login.actions.primarySignUp"
                  : "auth.backToLogin",
              )}
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
};
