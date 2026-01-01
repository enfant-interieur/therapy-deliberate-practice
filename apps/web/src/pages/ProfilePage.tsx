import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import { useGetMeQuery } from "../store/api";

export const ProfilePage = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetMeQuery();

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{t("profile.tagline")}</p>
        <h2 className="mt-3 text-3xl font-semibold">{t("profile.title")}</h2>
        <p className="mt-3 text-sm text-slate-300">{t("profile.subtitle")}</p>
      </section>
      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-8">
        {isLoading && <p className="text-sm text-slate-400">{t("profile.loading")}</p>}
        {isError && (
          <p className="text-sm text-rose-300">{t("profile.error")}</p>
        )}
        {data && (
          <div className="grid gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("profile.identity")}</p>
              <p className="mt-3 text-lg font-semibold text-white">
                {data.email ?? t("profile.emailUnavailable")}
              </p>
              <p className="mt-2 text-xs text-slate-400">{t("profile.userIdLabel", { id: data.id })}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-5">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("profile.accountCreated")}</p>
              <p className="mt-3 text-lg font-semibold text-white">
                {data.created_at ? new Date(data.created_at).toLocaleString() : t("profile.unknown")}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                {t("profile.openAiKeyLabel", {
                  status: data.hasOpenAiKey ? t("profile.openAiKeyConnected") : t("profile.openAiKeyNotConnected")
                })}
              </p>
            </div>
          </div>
        )}
      </section>
      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-8">
        <h3 className="text-lg font-semibold">{t("profile.actionsTitle")}</h3>
        <p className="mt-2 text-sm text-slate-300">{t("profile.actionsSubtitle")}</p>
        <button
          className="mt-4 rounded-full border border-white/10 px-6 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20"
          onClick={handleLogout}
        >
          {t("profile.logout")}
        </button>
      </section>
    </div>
  );
};
