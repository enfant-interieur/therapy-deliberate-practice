import { useTranslation } from "react-i18next";

export const PracticeJourney = ({ active }: { active?: 0 | 1 | 2 }) => {
  const { t } = useTranslation();
  return (
    <ol className="studio-phases" aria-label={t("studio.journey.label")}>
      {(["choose", "rehearse", "reflect"] as const).map((step, index) => (
        <li
          key={step}
          className="studio-phase"
          aria-current={active === index ? "step" : undefined}
        >
          <span className="studio-phase-number" aria-hidden="true">
            0{index + 1}
          </span>
          <p className="mt-1 font-semibold text-slate-100">
            {t(`studio.journey.${step}.title`)}
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {t(`studio.journey.${step}.body`)}
          </p>
        </li>
      ))}
    </ol>
  );
};
