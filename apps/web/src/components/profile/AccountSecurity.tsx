import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { authClient, authErrorKey, signOut } from "../../auth/client";
import { useAuthCapabilities } from "../../auth/useAuthCapabilities";

type Account = { id: string; providerId: string };
export function AccountSecurity() {
  const { t } = useTranslation();
  const capabilities = useAuthCapabilities();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sessionCount, setSessionCount] = useState<number | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [methods, sessions] = await Promise.all([
      authClient.listAccounts(),
      authClient.listSessions(),
    ]);
    if (methods.error || sessions.error) {
      setError(t("auth.errors.tryAgain"));
      return;
    }
    setAccounts(methods.data ?? []);
    setSessionCount(sessions.data?.length ?? null);
  }, [t]);
  useEffect(() => {
    void load().catch(() => setError(t("auth.errors.unavailable")));
  }, [load, t]);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await operation();
    } catch {
      setError(t("auth.errors.unavailable"));
    } finally {
      setBusy(false);
    }
  };
  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) {
        setError(t(authErrorKey(result.error.code)));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setInfo(t("auth.security.passwordChanged"));
      await load();
    });
  };
  const revokeAll = () =>
    void perform(async () => {
      const result = await authClient.revokeSessions();
      if (result.error) {
        setError(t(authErrorKey(result.error.code)));
        return;
      }
      await signOut();
    });
  return (
    <section className="studio-card rounded-3xl p-6 sm:p-8">
      <h2 className="text-xl font-semibold">{t("auth.security.title")}</h2>
      <p className="mt-2 text-sm text-slate-300">
        {t("auth.security.subtitle")}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-300">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="mt-4 text-sm text-teal-200">
          {info}
        </p>
      )}
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-semibold">{t("auth.security.methods")}</h3>
          <ul className="mt-3 space-y-3">
            {accounts.map((account) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3"
                key={account.id}
              >
                <span className="text-sm">
                  {account.providerId === "credential"
                    ? t("login.mode.signIn")
                    : ["google", "github", "apple"].includes(account.providerId)
                      ? t(`auth.providers.${account.providerId}`)
                      : t("auth.security.method")}
                </span>
                <button
                  type="button"
                  className="studio-secondary text-sm"
                  disabled={busy || accounts.length < 2}
                  onClick={() =>
                    void perform(async () => {
                      const result = await authClient.unlinkAccount({
                        accountId: account.id,
                      });
                      if (result.error) {
                        setError(t(authErrorKey(result.error.code)));
                        return;
                      }
                      await load();
                    })
                  }
                >
                  {t("auth.security.unlink")}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-3">
            {(["google", "github", "apple"] as const)
              .filter(
                (provider) =>
                  !accounts.some((account) => account.providerId === provider),
              )
              .map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className="studio-secondary text-sm"
                  disabled={
                    busy ||
                    !capabilities?.ready ||
                    !capabilities.providers[provider]
                  }
                  onClick={() =>
                    void perform(async () => {
                      const result = await authClient.linkSocial({
                        provider,
                        callbackURL: `${window.location.origin}/profile`,
                      });
                      if (result.error)
                        setError(t(authErrorKey(result.error.code)));
                    })
                  }
                >
                  {t("auth.security.link", {
                    provider: t(`auth.providers.${provider}`),
                  })}
                </button>
              ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            {t("auth.security.freshHint")}
          </p>
        </div>
        <div>
          <h3 className="font-semibold">{t("auth.security.sessions")}</h3>
          {sessionCount !== null && (
            <p className="mt-3 text-sm text-slate-300">
              {t("auth.security.sessionCount", { count: sessionCount })}
            </p>
          )}
          <button
            type="button"
            className="studio-secondary mt-4"
            disabled={busy}
            onClick={revokeAll}
          >
            {t("auth.security.signOutAll")}
          </button>
        </div>
      </div>
      {accounts.some((account) => account.providerId === "credential") && (
        <form
          onSubmit={changePassword}
          className="mt-8 grid gap-4 md:grid-cols-2"
        >
          <label className="block text-sm">
            {t("auth.currentPassword")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t("auth.newPassword")}
            <input
              className="rounded-xl border border-slate-500 bg-slate-950 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-teal-300 mt-2 w-full"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <p className="text-xs text-slate-400 md:col-span-2">
            {t("auth.passwordHint")}
          </p>
          <div>
            <button className="studio-primary" type="submit" disabled={busy}>
              {t(busy ? "auth.saving" : "auth.security.changePassword")}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
