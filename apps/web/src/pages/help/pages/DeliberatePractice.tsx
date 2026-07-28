import { useTranslation } from "react-i18next";
import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

export const DeliberatePractice = () => {
  const { t } = useTranslation();
  const habits = [
    t("help.deliberatePractice.habits.items.focus"),
    t("help.deliberatePractice.habits.items.listen"),
    t("help.deliberatePractice.habits.items.track"),
    t("help.deliberatePractice.habits.items.useFeedback"),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("help.deliberatePractice.header.kicker")}
        title={t("help.deliberatePractice.header.title")}
        subtitle={t("help.deliberatePractice.header.subtitle")}
      />

      <Section
        title={t("help.deliberatePractice.application.title")}
        subtitle={t("help.deliberatePractice.application.subtitle")}
      >
        <div className="space-y-3">
          <p>{t("help.deliberatePractice.application.bodyOne")}</p>
          <p>{t("help.deliberatePractice.application.bodyTwo")}</p>
        </div>
      </Section>

      <Section
        title={t("help.deliberatePractice.habits.title")}
        subtitle={t("help.deliberatePractice.habits.subtitle")}
      >
        <ul className="space-y-3">
          {habits.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3"
            >
              <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-teal-400/10 text-xs font-semibold text-teal-200">
                ✓
              </span>
              <span className="text-sm text-slate-200">{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Callout
        variant="note"
        title={t("help.deliberatePractice.callout.title")}
      >
        {t("help.deliberatePractice.callout.body")}
      </Callout>
    </div>
  );
};
