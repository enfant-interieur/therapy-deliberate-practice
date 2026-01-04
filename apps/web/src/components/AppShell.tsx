import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { useGetAdminWhoamiQuery, useGetMeSettingsQuery } from "../store/api";
import { setAdminStatus, setUser } from "../store/authSlice";
import { supabase } from "../supabase/client";
import { hydrateSettings } from "../store/settingsSlice";
import { AiSetupModal } from "./AiSetupModal";
import { GameSelectModal } from "./minigames/GameSelectModal";
import { Tooltip } from "./Tooltip";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"
  }`;

export const AppShell = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { isAdmin, isAuthenticated, authChecked, email } = useAppSelector((state) => state.auth);
  const { data, isError } = useGetAdminWhoamiQuery();
  const { data: settingsData } = useGetMeSettingsQuery(undefined, { skip: !isAuthenticated });
  const navigate = useNavigate();
  const location = useLocation();
  const selectedLanguage = i18n.resolvedLanguage ?? i18n.language;
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showAiSetup, setShowAiSetup] = useState(false);
  const [isGameSelectOpen, setIsGameSelectOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const handledAuthSignatureRef = useRef<string>("");

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void i18n.changeLanguage(event.target.value);
  };

  useEffect(() => {
    const run = async () => {
      const url = new URL(window.location.href);

      const code = url.searchParams.get("code");
      const urlError =
        url.searchParams.get("error_description") || url.searchParams.get("error") || null;

      const hashParams = new URLSearchParams(
        window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
      );
      const hashHasTokens = hashParams.has("access_token") || hashParams.has("refresh_token");
      const hashError = hashParams.get("error_description") || hashParams.get("error") || null;

      const hasAuthCallback = Boolean(code || hashHasTokens || urlError || hashError);
      if (!hasAuthCallback) return;

      const signature = [code ?? "", hashHasTokens ? "tokens" : "", urlError ?? "", hashError ?? ""].join(
        "|"
      );
      if (handledAuthSignatureRef.current === signature) return;
      handledAuthSignatureRef.current = signature;

      const errorMessage = urlError || hashError;
      if (errorMessage) {
        window.localStorage.setItem("authError", errorMessage);
      }

      try {
        if (code) {
          await supabase.auth.exchangeCodeForSession(code);
        } else if (hashHasTokens) {
          const authAny = supabase.auth as { getSessionFromUrl?: (options: { storeSession: boolean }) => Promise<unknown> };
          if (typeof authAny.getSessionFromUrl === "function") {
            await authAny.getSessionFromUrl({ storeSession: true });
          } else {
            await supabase.auth.getSession();
          }
        }
        await supabase.auth.getSession();
      } finally {
        const returnToFromUrl = url.searchParams.get("returnTo");
        const storedReturnTo = window.localStorage.getItem("authReturnTo");

        const safeReturnTo = (value: string | null) => {
          if (!value || !value.startsWith("/")) return null;
          if (value === "/login") return "/";
          return value;
        };

        const returnTo = safeReturnTo(returnToFromUrl) ?? safeReturnTo(storedReturnTo) ?? "/";

        window.localStorage.removeItem("authReturnTo");

        if (errorMessage) {
          navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
          return;
        }

        navigate(returnTo, { replace: true });
      }
    };

    void run();
  }, [navigate, location.key]);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!mounted) return;
      const session = sessionData.session;
      dispatch(
        setUser({
          userId: session?.user?.id ?? null,
          email: session?.user?.email ?? null,
          accessToken: session?.access_token ?? null,
          isAuthenticated: Boolean(session?.user?.id),
          authChecked: true
        })
      );
    };
    void init();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      dispatch(
        setUser({
          userId: session?.user?.id ?? null,
          email: session?.user?.email ?? null,
          accessToken: session?.access_token ?? null,
          isAuthenticated: Boolean(session?.user?.id),
          authChecked: true
        })
      );
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [dispatch]);

  useEffect(() => {
    if (settingsData) {
      dispatch(hydrateSettings(settingsData));
    }
  }, [settingsData, dispatch]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || !settingsData) return;
    const dismissed = window.sessionStorage.getItem("aiSetupDismissed") === "1";
    if (dismissed) return;
    const missingLocal = !settingsData.localLlmUrl || !settingsData.localSttUrl;
    const missingOpenAi = !settingsData.hasOpenAiKey;
    if (missingLocal || missingOpenAi) {
      setShowAiSetup(true);
    }
  }, [authChecked, isAuthenticated, settingsData]);

  useEffect(() => {
    if (data) {
      dispatch(
        setAdminStatus({
          isAdmin: data.isAdmin,
          email: data.email,
          isAuthenticated: data.isAuthenticated
        })
      );
    } else if (isError) {
      dispatch(
        setAdminStatus({
          isAdmin: false,
          email: null,
          isAuthenticated: false
        })
      );
    }
  }, [data, isError, dispatch]);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handleDocumentClick = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (userMenuRef.current.contains(event.target as Node)) return;
      setIsUserMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const openAiSetup = () => {
    setShowAiSetup(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <AiSetupModal
        open={showAiSetup}
        onClose={(reason) => {
          window.sessionStorage.setItem("aiSetupDismissed", "1");
          setShowAiSetup(false);
          if (reason === "skip") {
            return;
          }
        }}
      />
      <GameSelectModal
        open={isGameSelectOpen}
        onClose={() => setIsGameSelectOpen(false)}
        onSelect={(mode) => {
          setIsGameSelectOpen(false);
          navigate("/minigames", { state: { preselectedMode: mode } });
        }}
      />
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-teal-400">{t("appShell.brand")}</p>
            <h1 className="text-lg font-semibold">{t("appShell.title")}</h1>
          </div>
          <nav className="flex items-center gap-2">
            <NavLink to="/" className={linkClass} end>
              {t("appShell.nav.library")}
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin" className={linkClass}>
                {t("appShell.nav.admin")}
              </NavLink>
            )}
            <button
              type="button"
              onClick={() => setIsGameSelectOpen(true)}
              className="rounded-full px-4 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              {t("appShell.nav.minigames")}
            </button>
            <Tooltip label={t("leaderboard.tooltip")}>
              <NavLink
                to="/leaderboard"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                aria-label={t("leaderboard.tooltip")}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 21h8m-4-4v4m6-13V5a1 1 0 0 0-1-1h-1V3a1 1 0 1 0-2 0v1h-4V3a1 1 0 1 0-2 0v1H7a1 1 0 0 0-1 1v3a3 3 0 0 0 3 3h.2a5 5 0 0 0 9.6 0H19a3 3 0 0 0 3-3V8a1 1 0 0 0-1-1h-1Zm-1 0v1a1 1 0 0 1-1 1h-.4a5.02 5.02 0 0 0 .2-1.4V6h1Zm-12 0h1v1.6c0 .48.07.95.2 1.4H9a1 1 0 0 1-1-1V7Z"
                  />
                </svg>
              </NavLink>
            </Tooltip>
            <NavLink
              to="/help"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition hover:border-white/20 hover:text-white"
              aria-label={t("appShell.nav.help")}
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.09 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4m.08 3.5h.02M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                />
              </svg>
            </NavLink>
            <label className="sr-only" htmlFor="language-select">
              {t("appShell.language.label")}
            </label>
            <select
              id="language-select"
              className="rounded-full border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-white"
              value={selectedLanguage}
              onChange={handleLanguageChange}
            >
              <option value="en">{t("appShell.language.english")}</option>
              <option value="fr">{t("appShell.language.french")}</option>
            </select>
            {authChecked && !isAuthenticated && (
              <NavLink to="/login" className="rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950">
                {t("appShell.nav.login")}
              </NavLink>
            )}
            {authChecked && isAuthenticated && (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition hover:border-white/20 hover:text-white"
                  aria-label={t("appShell.nav.profile")}
                  aria-haspopup="menu"
                  aria-expanded={isUserMenuOpen}
                  onClick={() => setIsUserMenuOpen((open) => !open)}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.5 20.118a7.5 7.5 0 0 1 15 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.5-1.632Z"
                    />
                  </svg>
                </button>
                {isUserMenuOpen && (
                  <div
                    className="absolute right-0 mt-3 w-56 rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-xl shadow-black/30"
                    role="menu"
                  >
                    <div className="px-3 py-2">
                      <p className="text-xs uppercase tracking-[0.2em] text-teal-400">{t("appShell.nav.profile")}</p>
                      <p className="text-sm text-slate-200">{email ?? " "}</p>
                    </div>
                    <div className="my-2 h-px bg-white/10" />
                    <NavLink
                      to="/profile"
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                      role="menuitem"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      {t("appShell.nav.profile")}
                    </NavLink>
                    <NavLink
                      to="/settings"
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                      role="menuitem"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      {t("appShell.nav.settings")}
                    </NavLink>
                    <NavLink
                      to="/history"
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                      role="menuitem"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      {t("appShell.nav.history")}
                    </NavLink>
                    <NavLink
                      to="/help"
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
                      role="menuitem"
                      onClick={() => setIsUserMenuOpen(false)}
                    >
                      {t("appShell.nav.help")}
                    </NavLink>
                    <button
                      type="button"
                      className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-200 transition hover:bg-white/10"
                      role="menuitem"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        void handleLogout();
                      }}
                    >
                      {t("appShell.nav.logout")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet context={{ openAiSetup }} />
      </main>
    </div>
  );
};
