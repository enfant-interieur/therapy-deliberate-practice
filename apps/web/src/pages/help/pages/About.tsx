import { useTranslation } from "react-i18next";
import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

export const About = () => {
  const { t } = useTranslation();
  const privacyItems = [
    t("help.about.privacy.items.audio"),
    t("help.about.privacy.items.apiKeys"),
    t("help.about.privacy.items.localInference"),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("help.about.header.kicker")}
        title={t("help.about.header.title")}
        subtitle={t("help.about.header.subtitle")}
      />

      <Section
        title={t("help.about.product.title")}
        subtitle={t("help.about.product.subtitle")}
      >
        <div className="space-y-3">
          <p>{t("help.about.product.bodyOne")}</p>
          <p>{t("help.about.product.bodyTwo")}</p>
        </div>
      </Section>

      <Section
        title={t("help.about.privacy.title")}
        subtitle={t("help.about.privacy.subtitle")}
      >
        <ul className="space-y-3 text-sm text-slate-200">
          {privacyItems.map((item) => (
            <li
              key={item}
              className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"
            >
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Callout variant="tip" title={t("help.about.callout.title")}>
        {t("help.about.callout.body")}
      </Callout>
    </div>
  );
};
