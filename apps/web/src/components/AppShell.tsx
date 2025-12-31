import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { useGetAdminWhoamiQuery, useGetMeSettingsQuery } from "../store/api";
import { setAdminStatus, setUser } from "../store/authSlice";
import { supabase } from "../supabase/client";
import { hydrateSettings } from "../store/settingsSlice";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"
  }`;

export const AppShell = () => {
  const dispatch = useAppDispatch();
  const { isAdmin, isAuthenticated, authChecked, email } = useAppSelector((state) => state.auth);
  const { data, isError } = useGetAdminWhoamiQuery();
  const { data: settingsData } = useGetMeSettingsQuery(undefined, { skip: !isAuthenticated });
  const navigate = useNavigate();
  const location = useLocation();

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

        const safeReturnTo = (value: string | null) => (value && value.startsWith("/") ? value : null);

        const returnTo = safeReturnTo(returnToFromUrl) ?? safeReturnTo(storedReturnTo) ?? "/";

        window.localStorage.removeItem("authReturnTo");

        const clean = new URL(window.location.href);
        clean.searchParams.delete("code");
        clean.searchParams.delete("state");
        clean.searchParams.delete("error");
        clean.searchParams.delete("error_code");
        clean.searchParams.delete("error_description");
        clean.hash = "";
        window.history.replaceState({}, document.title, clean.pathname + clean.search);

        if (errorMessage) {
          if (location.pathname !== "/login") {
            navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
          }
          return;
        }

        if (location.pathname !== returnTo) {
          navigate(returnTo, { replace: true });
        }
      }
    };

    void run();
  }, [navigate, location.pathname]);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      <header className="sticky top-0 z-20 border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-teal-400">Deliberate Practice</p>
            <h1 className="text-lg font-semibold">Therapy Studio</h1>
          </div>
          <nav className="flex items-center gap-2">
            <NavLink to="/" className={linkClass} end>
              Library
            </NavLink>
            <NavLink to="/history" className={linkClass}>
              History
            </NavLink>
            {isAuthenticated && (
              <>
                <NavLink to="/profile" className={linkClass}>
                  Profile
                </NavLink>
                <NavLink to="/settings" className={linkClass}>
                  Settings
                </NavLink>
              </>
            )}
            {isAdmin && (
              <NavLink to="/admin/library" className={linkClass}>
                Admin
              </NavLink>
            )}
            {authChecked && !isAuthenticated && (
              <NavLink to="/login" className="rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950">
                Log in
              </NavLink>
            )}
            {authChecked && isAuthenticated && (
              <button
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20"
                onClick={handleLogout}
              >
                Log out {email ? `(${email})` : ""}
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
};
