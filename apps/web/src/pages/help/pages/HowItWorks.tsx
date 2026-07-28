import { useTranslation } from "react-i18next";
import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

export const HowItWorks = () => {
  const { t } = useTranslation();
  const steps = [
    {
      title: t("help.howItWorks.steps.selectTask.title"),
      description: t("help.howItWorks.steps.selectTask.description"),
    },
    {
      title: t("help.howItWorks.steps.generatePrompt.title"),
      description: t("help.howItWorks.steps.generatePrompt.description"),
    },
    {
      title: t("help.howItWorks.steps.recordResponse.title"),
      description: t("help.howItWorks.steps.recordResponse.description"),
    },
    {
      title: t("help.howItWorks.steps.evaluateCriteria.title"),
      description: t("help.howItWorks.steps.evaluateCriteria.description"),
    },
    {
      title: t("help.howItWorks.steps.reviewFeedback.title"),
      description: t("help.howItWorks.steps.reviewFeedback.description"),
    },
    {
      title: t("help.howItWorks.steps.trackProgress.title"),
      description: t("help.howItWorks.steps.trackProgress.description"),
    },
  ];
  const scoringSignals = [
    t("help.howItWorks.scoringSignals.items.rubric"),
    t("help.howItWorks.scoringSignals.items.tone"),
    t("help.howItWorks.scoringSignals.items.alignment"),
    t("help.howItWorks.scoringSignals.items.context"),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("help.howItWorks.header.kicker")}
        title={t("help.howItWorks.header.title")}
        subtitle={t("help.howItWorks.header.subtitle")}
      />

      <Section
        title={t("help.howItWorks.flow.title")}
        subtitle={t("help.howItWorks.flow.subtitle")}
      >
        <div className="space-y-5">
          {steps.map((step, index) => (
            <div key={step.title} className="flex gap-4">
              <div className="flex flex-col items-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-sm font-semibold text-teal-200">
                  {index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span className="mt-2 h-full w-px bg-white/10" />
                ) : null}
              </div>
              <div className="pb-6">
                <h3 className="text-base font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mt-1 text-sm text-slate-300">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title={t("help.howItWorks.scoringSignals.title")}
        subtitle={t("help.howItWorks.scoringSignals.subtitle")}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {scoringSignals.map((item) => (
            <li
              key={item}
              className="rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-slate-200"
            >
              {item}
            </li>
          ))}
        </ul>
      </Section>

      <Callout variant="tip" title={t("help.howItWorks.callout.title")}>
        {t("help.howItWorks.callout.body")}
      </Callout>
    </div>
  );
};
