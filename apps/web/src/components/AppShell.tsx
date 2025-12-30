import { NavLink, Outlet } from "react-router-dom";
import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { useGetAdminWhoamiQuery } from "../store/api";
import { setAdminStatus } from "../store/authSlice";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-4 py-2 text-sm font-semibold transition ${
    isActive ? "bg-white text-slate-950" : "text-slate-300 hover:text-white"
  }`;

export const AppShell = () => {
  const dispatch = useAppDispatch();
  const isAdmin = useAppSelector((state) => state.auth.isAdmin);
  const { data, isError } = useGetAdminWhoamiQuery();

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
            {isAdmin && (
              <NavLink to="/admin/library" className={linkClass}>
                Admin
              </NavLink>
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
