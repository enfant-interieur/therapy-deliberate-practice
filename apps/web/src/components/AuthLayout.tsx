import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { StudioArtwork } from "./StudioArtwork";
import "./AuthLayout.css";

export function AuthLayout({
  title,
  introduction,
  children,
}: {
  title: string;
  introduction?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="auth-layout" aria-labelledby="auth-title">
      <aside className="auth-art-panel" aria-hidden="true">
        <StudioArtwork
          scene="shelter"
          className="auth-artwork"
          sizes="(min-width: 900px) 440px, 1px"
        />
        <div className="auth-art-caption">
          <p>{t("auth.design.eyebrow")}</p>
          <span>{t("auth.design.caption")}</span>
        </div>
      </aside>
      <div className="auth-form-panel">
        <div className="auth-form-content">
          <header className="auth-heading">
            <h1 id="auth-title">{title}</h1>
            {introduction && <p>{introduction}</p>}
          </header>
          {children}
        </div>
      </div>
    </section>
  );
}
