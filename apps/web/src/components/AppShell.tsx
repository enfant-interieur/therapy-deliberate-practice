import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  useGetAdminWhoamiQuery,
  useGetMeQuery,
  useGetMeSettingsQuery,
} from "../store/api";
import { setAdminStatus } from "../store/authSlice";
import { signOut } from "../auth/client";
import { useAuthSync } from "../auth/useAuthSync";
import { hydrateSettings } from "../store/settingsSlice";
import { AiSetupModal } from "./AiSetupModal";
import { Tooltip } from "./Tooltip";
import { Drawer } from "./Drawer";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { safeInternalReturnTo } from "../utils/safeReturnTo";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive
      ? "bg-teal-300/15 text-teal-100"
      : "text-slate-300 hover:bg-white/5 hover:text-white"
  }`;

export const AppShell = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const { isAdmin, isAuthenticated, authChecked, email, userId } =
    useAppSelector((state) => state.auth);
  const isAppShellHidden = useAppSelector(
    (state) => state.minigames.ui.appShellHidden,
  );
  const { data, isError } = useGetAdminWhoamiQuery();
  const { data: profileData } = useGetMeQuery(undefined, {
    skip: !isAuthenticated,
  });
  const { data: settingsData } = useGetMeSettingsQuery(undefined, {
    skip: !isAuthenticated,
  });
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthPage = [
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
  ].includes(location.pathname);
  const selectedLanguage = i18n.resolvedLanguage ?? i18n.language;
  const displayName = profileData?.display_name ?? email ?? "";
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showAiSetup, setShowAiSetup] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  useAuthSync();
  const [logoutFailed, setLogoutFailed] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    void i18n.changeLanguage(event.target.value);
  };

  useEffect(() => {
    if (location.pathname === "/reset-password") return;
    const url = new URL(window.location.href);
    const error = url.searchParams.get("error");
    if (!error && !url.searchParams.has("error_description")) return;
    const returnTo =
      safeInternalReturnTo(url.searchParams.get("returnTo")) ?? "/";
    navigate(
      `/login?returnTo=${encodeURIComponent(returnTo)}&authError=${error === "access_denied" ? "denied" : "failed"}`,
      { replace: true },
    );
  }, [navigate, location.key, location.pathname]);

  useEffect(() => {
    if (settingsData) {
      dispatch(hydrateSettings(settingsData));
    }
  }, [settingsData, dispatch]);

  useEffect(() => {
    if (!authChecked || !isAuthenticated || !settingsData) return;
    const dismissed = window.sessionStorage.getItem("aiSetupDismissed") === "1";
    if (dismissed) return;
    const missingLocal =
      !settingsData.localAiBaseUrl &&
      (!settingsData.localLlmUrl || !settingsData.localSttUrl);
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
          isAuthenticated: data.isAuthenticated,
        }),
      );
    } else if (isError) {
      dispatch(
        setAdminStatus({
          isAdmin: false,
          email: null,
          isAuthenticated: false,
        }),
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
    setIsDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isMobile) {
      setIsDrawerOpen(false);
    }
  }, [isMobile]);

  const handleLogout = async () => {
    setLogoutFailed(false);
    try {
      await signOut();
    } catch {
      setLogoutFailed(true);
    }
  };

  const openAiSetup = () => {
    setShowAiSetup(true);
  };

  const handleDrawerMinigames = () => {
    setIsDrawerOpen(false);
    navigate("/minigames");
  };

  const navItems = [
    { key: "library", label: t("appShell.nav.library"), to: "/", exact: true },
    ...(isAdmin
      ? [{ key: "admin", label: t("appShell.nav.admin"), to: "/admin" }]
      : []),
    {
      key: "minigames",
      label: t("appShell.nav.minigames"),
      onClick: handleDrawerMinigames,
    },
    { key: "leaderboard", label: t("leaderboard.tooltip"), to: "/leaderboard" },
    { key: "help", label: t("appShell.nav.help"), to: "/help" },
  ];

  return (
    <div className="studio-shell min-h-screen">
      <a className="studio-skip" href="#studio-main">
        {t("studio.skip")}
      </a>
      <AiSetupModal
        key={userId ?? "anonymous"}
        open={showAiSetup}
        onClose={(reason) => {
          window.sessionStorage.setItem("aiSetupDismissed", "1");
          setShowAiSetup(false);
          if (reason === "skip") {
            return;
          }
        }}
      />
      {!isAppShellHidden && (
        <header className="studio-header sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="studio-brand-lockup">
              <img
                src="/brand/studio-mark.svg"
                alt=""
                aria-hidden="true"
                width="40"
                height="40"
              />
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-teal-300">
                  {t("appShell.brand")}
                </p>
                <p className="studio-brand text-base font-semibold sm:text-lg">
                  {t("appShell.title")}
                </p>
              </div>
            </div>
            <nav
              className="flex items-center gap-1"
              aria-label={t("studio.navigation")}
            >
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setIsDrawerOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-slate-200 transition hover:border-white/20 hover:text-white"
                  aria-label={t("appShell.nav.menu")}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 6h16M4 12h16M4 18h16"
                    />
                  </svg>
                </button>
              ) : (
                <>
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
                    onClick={() => navigate("/minigames")}
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
                      <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      >
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
                    <svg
                      viewBox="0 0 24 24"
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
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
                  {authChecked && !isAuthenticated && !isAuthPage && (
                    <NavLink
                      to="/login"
                      className="rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950"
                    >
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
                        <svg
                          viewBox="0 0 24 24"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
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
                            <p className="text-xs uppercase tracking-[0.2em] text-teal-400">
                              {t("appShell.nav.profile")}
                            </p>
                            <p className="text-sm font-semibold text-white">
                              {displayName || " "}
                            </p>
                            <p className="text-xs text-slate-400">
                              {email ?? " "}
                            </p>
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
                </>
              )}
            </nav>
          </div>
          {isAuthenticated && (
            <nav
              className="studio-toolbar mx-auto max-w-6xl border-t border-white/5 px-4 pb-2 pt-1 sm:px-6"
              aria-label={t("studio.workspace")}
            >
              <NavLink to="/history">{t("appShell.nav.history")}</NavLink>
              <NavLink to="/settings">{t("appShell.nav.settings")}</NavLink>
              <span className="ml-auto hidden text-xs text-slate-400 sm:block">
                {t("studio.practiceNote")}
              </span>
            </nav>
          )}
        </header>
      )}
      <Drawer
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        ariaLabel={t("appShell.nav.menu")}
      >
        <div className="flex h-full flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-400">
              {t("appShell.brand")}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-white">
              {t("appShell.title")}
            </h2>
          </div>
          <div className="space-y-1">
            {navItems.map((item) =>
              item.to ? (
                <NavLink
                  key={item.key}
                  to={item.to}
                  end={item.exact}
                  className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                  onClick={() => setIsDrawerOpen(false)}
                >
                  {item.label}
                </NavLink>
              ) : (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                >
                  {item.label}
                </button>
              ),
            )}
          </div>
          <div className="mt-auto space-y-4 rounded-3xl border border-white/10 bg-white/5 p-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">
                {t("appShell.language.label")}
              </p>
              <select
                aria-label={t("appShell.language.label")}
                className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white"
                value={selectedLanguage}
                onChange={handleLanguageChange}
              >
                <option value="en">{t("appShell.language.english")}</option>
                <option value="fr">{t("appShell.language.french")}</option>
              </select>
            </div>
            {authChecked && !isAuthenticated && !isAuthPage && (
              <NavLink
                to="/login"
                className="flex w-full items-center justify-center rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950"
                onClick={() => setIsDrawerOpen(false)}
              >
                {t("appShell.nav.login")}
              </NavLink>
            )}
            {authChecked && isAuthenticated && (
              <div className="space-y-2">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-teal-300">
                    {t("appShell.nav.profile")}
                  </p>
                  <p className="text-sm font-semibold text-white">
                    {displayName || " "}
                  </p>
                  <p className="text-xs text-slate-400">{email ?? " "}</p>
                </div>
                <div className="grid gap-2">
                  <NavLink
                    to="/profile"
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80"
                    onClick={() => setIsDrawerOpen(false)}
                  >
                    {t("appShell.nav.profile")}
                  </NavLink>
                  <NavLink
                    to="/settings"
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80"
                    onClick={() => setIsDrawerOpen(false)}
                  >
                    {t("appShell.nav.settings")}
                  </NavLink>
                  <NavLink
                    to="/history"
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80"
                    onClick={() => setIsDrawerOpen(false)}
                  >
                    {t("appShell.nav.history")}
                  </NavLink>
                  <button
                    type="button"
                    className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-semibold text-white/80"
                    onClick={() => {
                      setIsDrawerOpen(false);
                      void handleLogout();
                    }}
                  >
                    {t("appShell.nav.logout")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Drawer>
      <main
        id="studio-main"
        tabIndex={-1}
        className={
          isAppShellHidden
            ? "w-full p-0"
            : "studio-main mx-auto max-w-6xl px-6 pb-16"
        }
      >
        {logoutFailed && (
          <p role="alert" className="mb-4 text-rose-200">
            {t("auth.errors.signOut")}
          </p>
        )}
        <Outlet context={{ openAiSetup }} />
      </main>
    </div>
  );
};
