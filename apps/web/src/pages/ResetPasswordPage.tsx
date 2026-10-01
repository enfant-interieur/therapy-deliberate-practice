import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authClient, authErrorKey } from "../auth/client";

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
    <section className="studio-card mx-auto max-w-lg rounded-3xl p-6 sm:p-8">
      <p className="studio-eyebrow">{t("auth.recovery.eyebrow")}</p>
      <h1 className="studio-heading mt-3 text-3xl">
        {t("auth.recovery.title")}
      </h1>
      {complete ? (
        <p role="status" className="mt-5 text-teal-200">
          {t("auth.recovery.complete")}
        </p>
      ) : !token ? (
        <p role="alert" className="mt-5 text-rose-300">
          {t("auth.errors.expiredLink")}
        </p>
      ) : (
        <form
          onSubmit={(event) => void submit(event)}
          className="mt-6 space-y-4"
        >
          <p className="text-sm text-slate-300">{t("auth.passwordHint")}</p>
          <label className="block text-sm">
            {t("auth.newPassword")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t("login.placeholders.confirmPassword")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
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
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          )}
          <button
            className="studio-primary w-full"
            type="submit"
            disabled={busy}
          >
            {t(busy ? "auth.saving" : "auth.recovery.save")}
          </button>
        </form>
      )}
      <Link className="studio-secondary mt-6 inline-flex" to="/login">
        {t("auth.backToLogin")}
      </Link>
    </section>
  );
}
