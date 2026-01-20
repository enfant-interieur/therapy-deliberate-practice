import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../supabase/client";
import { useGetMeQuery, useGetPublicProfileQuery, useUpdateMeProfileMutation } from "../store/api";
import { ProfileInsightsSection, type ProfileInsightsCopy } from "../components/profile/ProfileInsightsSection";

export const ProfilePage = () => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGetMeQuery();
  const {
    data: analyticsResponse,
    isFetching: isInsightsLoading
  } = useGetPublicProfileQuery(data?.id ?? "", { skip: !data?.id });
  const [updateProfile, updateState] = useUpdateMeProfileMutation();
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isProfilePublic, setIsProfilePublic] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setDisplayName(data.display_name ?? "");
    setBio(data.bio ?? "");
    setIsProfilePublic(Boolean(data.is_profile_public));
  }, [data]);

  useEffect(
    () => () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    },
    []
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await updateProfile({
      displayName: displayName.trim(),
      bio: bio.trim() ? bio.trim() : null,
      isPublicProfile: isProfilePublic
    });
  };

  const publicProfileUrl = useMemo(() => {
    if (!data?.id) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}/profiles/${data.id}`;
  }, [data?.id]);

  const handleCopyLink = async () => {
    if (!publicProfileUrl) return;
    try {
      if (!navigator.clipboard) {
        throw new Error("clipboard_unavailable");
      }
      await navigator.clipboard.writeText(publicProfileUrl);
      setCopyFeedback("copied");
    } catch {
      setCopyFeedback("error");
    }
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopyFeedback("idle"), 2400);
  };

  const privacyToggleLabel = isProfilePublic ? t("profile.privacy.toggleOn") : t("profile.privacy.toggleOff");

  const insightsCopy = useMemo<ProfileInsightsCopy>(
    () => ({
      summary: {
        averageScoreLabel: t("profile.insights.summary.averageScore"),
        averageScoreHelper: t("profile.insights.summary.averageScoreHelper"),
        practiceMinutesLabel: t("profile.insights.summary.practiceMinutes"),
        practiceMinutesHelper: t("profile.insights.summary.practiceMinutesHelper"),
        sessionsLabel: t("profile.insights.summary.sessions"),
        sessionsHelper: (count) => t("profile.insights.summary.sessionsHelper", { count }),
        streakLabel: t("profile.insights.summary.streak"),
        streakValue: (days) => t("profile.insights.summary.streakValue", { days }),
        streakHelper: (days) => t("profile.insights.summary.streakHelper", { days })
      },
      timeline: {
        title: t("profile.insights.timeline.title"),
        subtitle: t("profile.insights.timeline.subtitle"),
        empty: t("profile.insights.timeline.empty"),
        tooltip: (count) => t("profile.insights.timeline.tooltip", { count })
      },
      difficulty: {
        title: t("profile.insights.difficulty.title"),
        subtitle: t("profile.insights.difficulty.subtitle"),
        empty: t("profile.insights.difficulty.empty"),
        label: (level) => t("profile.insights.difficulty.sliceLabel", { level }),
        tooltip: (count, score) => t("profile.insights.difficulty.tooltip", { count, score })
      },
      skill: {
        title: t("profile.insights.skill.title"),
        subtitle: t("profile.insights.skill.subtitle"),
        empty: t("profile.insights.skill.empty"),
        tooltip: (count, score) => t("profile.insights.skill.tooltip", { count, score })
      },
      tags: {
        title: t("profile.insights.tags.title"),
        subtitle: t("profile.insights.tags.subtitle"),
        empty: t("profile.insights.tags.empty"),
        tooltip: (count, score) => t("profile.insights.tags.tooltip", { count, score })
      },
      practice: {
        title: t("profile.insights.practiceCard.title"),
        totalAttempts: t("profile.insights.practiceCard.totalAttempts"),
        averageSession: t("profile.insights.practiceCard.averageSession"),
        currentStreak: t("profile.insights.practiceCard.currentStreak"),
        bestStreak: t("profile.insights.practiceCard.bestStreak")
      },
      minigame: {
        title: t("profile.insights.minigame.title"),
        sessionsHosted: t("profile.insights.minigame.sessionsHosted"),
        roundsCompleted: t("profile.insights.minigame.roundsCompleted"),
        players: t("profile.insights.minigame.players"),
        avgRounds: t("profile.insights.minigame.avgRounds"),
        recentTitle: t("profile.insights.minigame.recentTitle"),
        recentMeta: (rounds, players, minutes) =>
          t("profile.insights.minigame.recentMeta", { rounds, players, minutes })
      },
      minigameEmpty: t("profile.insights.minigameEmpty")
    }),
    [t]
  );

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
              <p className="mt-3 text-lg font-semibold text-white">{data.display_name}</p>
              <p className="mt-2 text-sm text-slate-300">
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
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">{t("profile.profileTitle")}</h3>
            <p className="mt-2 text-sm text-slate-300">{t("profile.profileSubtitle")}</p>
          </div>
          {updateState.isSuccess && (
            <span className="rounded-full border border-teal-400/40 bg-teal-400/10 px-3 py-1 text-xs font-semibold text-teal-200">
              {t("profile.profileSaved")}
            </span>
          )}
        </div>
        <form className="mt-6 grid gap-6 md:grid-cols-2" onSubmit={handleProfileSubmit}>
          <label className="block text-sm text-slate-200">
            <span className="text-sm font-semibold">{t("profile.displayNameLabel")}</span>
            <input
              className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("profile.displayNamePlaceholder")}
              maxLength={40}
              required
            />
          </label>
          <label className="block text-sm text-slate-200 md:col-span-2">
            <span className="text-sm font-semibold">{t("profile.bioLabel")}</span>
            <textarea
              className="mt-2 min-h-[120px] w-full resize-none rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder={t("profile.bioPlaceholder")}
              maxLength={160}
            />
          </label>
          <div className="md:col-span-2 rounded-2xl border border-white/10 bg-gradient-to-r from-slate-950 via-slate-900/80 to-slate-950 p-5 shadow-[0_25px_80px_-60px_rgba(15,23,42,0.9)]">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{t("profile.privacy.title")}</p>
                <p className="mt-1 text-sm text-slate-300">{t("profile.privacy.subtitle")}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isProfilePublic}
                aria-label={t("profile.privacy.ariaLabel")}
                onClick={() => setIsProfilePublic((prev) => !prev)}
                className={`inline-flex items-center rounded-full border px-2 py-1 transition ${
                  isProfilePublic ? "border-teal-400/70 bg-teal-400/10" : "border-white/10 bg-white/5"
                }`}
              >
                <span
                  className={`relative inline-flex h-9 w-16 items-center rounded-full transition ${
                    isProfilePublic ? "bg-teal-500/80" : "bg-slate-800/80"
                  }`}
                >
                  <span
                    className={`h-7 w-7 rounded-full bg-white text-sm font-semibold text-slate-900 shadow transition ${
                      isProfilePublic ? "translate-x-8" : "translate-x-1"
                    }`}
                  />
                </span>
                <span className="ml-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-200">
                  {privacyToggleLabel}
                </span>
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {isProfilePublic ? t("profile.privacy.helperOn") : t("profile.privacy.helperOff")}
            </p>
            {isProfilePublic ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{t("profile.privacy.linkLabel")}</p>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex-1 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white">
                    {publicProfileUrl}
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="rounded-full border border-teal-400/40 px-5 py-2 text-sm font-semibold text-teal-200 transition hover:border-teal-300/70"
                  >
                    {copyFeedback === "copied"
                      ? t("profile.privacy.copied")
                      : copyFeedback === "error"
                        ? t("profile.privacy.copyError")
                        : t("profile.privacy.copyLink")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-white/5 bg-slate-950/40 px-4 py-3 text-xs text-slate-400">
                {t("profile.privacy.privateHint")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <button
              className="rounded-full border border-white/10 px-6 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/20"
              type="submit"
              disabled={updateState.isLoading}
            >
              {updateState.isLoading ? t("profile.profileSaving") : t("profile.profileSave")}
            </button>
            {updateState.isError && (
              <span className="text-sm text-rose-300">{t("profile.profileError")}</span>
            )}
          </div>
        </form>
      </section>
      <ProfileInsightsSection
        heading={t("profile.insights.title")}
        description={t("profile.insights.subtitle")}
        emptyLabel={t("profile.insights.empty")}
        insights={analyticsResponse?.profile.insights}
        loading={isInsightsLoading}
        copy={insightsCopy}
      />
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
