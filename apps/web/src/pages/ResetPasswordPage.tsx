import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authClient, authErrorKey } from "../auth/client";
import { AuthLayout } from "../components/AuthLayout";

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [token] = useState(() =>
    new URLSearchParams(window.location.search).get("token"),
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  useEffect(() => {
    // The recovery token stays in this form's memory, away from referers and browser history.
    const url = new URL(window.location.href);
    url.searchParams.delete("token");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}`,
    );
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError(t("auth.errors.expiredLink"));
      return;
    }
    if (password !== confirm) {
      setError(t("login.errors.passwordMismatch"));
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (result.error) setError(t(authErrorKey(result.error.code)));
      else {
        setComplete(true);
        setPassword("");
        setConfirm("");
      }
    } catch {
      setError(t("auth.errors.unavailable"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={t("auth.recovery.title")}>
      {complete ? (
        <p role="status" className="auth-message auth-message--status">
          {t("auth.recovery.complete")}
        </p>
      ) : !token ? (
        <p role="alert" className="auth-message auth-message--error">
          {t("auth.errors.expiredLink")}
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="auth-form">
          <p className="auth-hint">{t("auth.passwordHint")}</p>
          <label className="auth-field">
            {t("auth.newPassword")}
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="auth-field">
            {t("login.placeholders.confirmPassword")}
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="auth-message auth-message--error">
              {error}
            </p>
          )}
          <button className="auth-primary" type="submit" disabled={busy}>
            {t(busy ? "auth.saving" : "auth.recovery.save")}
          </button>
        </form>
      )}
      <p className="auth-switch">
        {!complete && !token && (
          <Link className="auth-link" to="/forgot-password">
            {t("login.actions.resetPassword")}
          </Link>
        )}
        <Link className="auth-link" to="/login">
          {t("auth.backToLogin")}
        </Link>
      </p>
    </AuthLayout>
  );
}
