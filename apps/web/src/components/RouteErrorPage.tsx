import { useTranslation } from "react-i18next";
import { AuthLayout } from "./AuthLayout";

// Keep this eagerly loaded: it must also work when a retired lazy chunk cannot load.
export function RouteErrorPage() {
  const { t } = useTranslation();
  return (
    <main className="studio-shell min-h-screen px-6 py-12">
      <AuthLayout
        title={t("auth.routeError.title")}
        introduction={t("auth.routeError.description")}
      >
        <div className="auth-confirmation">
          <button
            type="button"
            className="auth-primary"
            onClick={() => window.location.reload()}
          >
            {t("auth.routeError.reload")}
          </button>
          <a className="auth-link" href="/">
            {t("auth.routeError.library")}
          </a>
        </div>
      </AuthLayout>
    </main>
  );
}
