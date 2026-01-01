import { PropsWithChildren } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "../store/hooks";

export const UserRouteGuard = ({ children }: PropsWithChildren) => {
  const { t } = useTranslation();
  const { isAuthenticated, authChecked } = useAppSelector((state) => state.auth);
  const location = useLocation();

  if (!authChecked) {
    return (
      <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 text-sm text-slate-300">
        {t("routeGuard.checkingSession")}
      </div>
    );
  }

  if (!isAuthenticated) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  return <>{children}</>;
};
