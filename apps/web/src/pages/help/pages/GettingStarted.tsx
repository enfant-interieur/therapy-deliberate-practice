import { Link, useOutletContext } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Callout } from "../components/Callout";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

type HelpContext = {
  openAiSetup?: () => void;
};

export const GettingStarted = () => {
  const { openAiSetup } = useOutletContext<HelpContext>();
  const { t } = useTranslation();

  const quickStartSteps = [
    {
      title: t("help.gettingStarted.quickStart.steps.chooseTask.title"),
      description: t(
        "help.gettingStarted.quickStart.steps.chooseTask.description",
      ),
    },
    {
      title: t("help.gettingStarted.quickStart.steps.configureAi.title"),
      description: t(
        "help.gettingStarted.quickStart.steps.configureAi.description",
      ),
    },
    {
      title: t("help.gettingStarted.quickStart.steps.practiceReview.title"),
      description: t(
        "help.gettingStarted.quickStart.steps.practiceReview.description",
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        kicker={t("help.gettingStarted.header.kicker")}
        title={t("help.gettingStarted.header.title")}
        subtitle={t("help.gettingStarted.header.subtitle")}
        actions={
          <>
            <button
              type="button"
              onClick={() => openAiSetup?.()}
              className="rounded-full bg-teal-400 px-5 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-teal-500/30 transition hover:bg-teal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              {t("help.gettingStarted.actions.launchSetup")}
            </button>
            <Link
              to="/settings"
              className="rounded-full border border-white/10 bg-white/5 px-5 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              {t("help.gettingStarted.actions.openSettings")}
            </Link>
          </>
        }
      />

      <Section
        title={t("help.gettingStarted.purpose.title")}
        subtitle={t("help.gettingStarted.purpose.subtitle")}
      >
        <div className="space-y-3 text-sm text-slate-200">
          <p>{t("help.gettingStarted.purpose.bodyOne")}</p>
          <p>{t("help.gettingStarted.purpose.bodyTwo")}</p>
        </div>
      </Section>

      <Section
        title={t("help.gettingStarted.quickStart.title")}
        subtitle={t("help.gettingStarted.quickStart.subtitle")}
      >
        <ol className="grid gap-4 md:grid-cols-3">
          {quickStartSteps.map((step, index) => (
            <li
              key={step.title}
              className="rounded-3xl border border-white/10 bg-slate-950/60 p-4"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-teal-400/10 text-sm font-semibold text-teal-200">
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {step.title}
                  </p>
                  <p className="text-xs text-slate-400">{step.description}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title={t("help.gettingStarted.troubleshooting.title")}
        subtitle={t("help.gettingStarted.troubleshooting.subtitle")}
      >
        <div className="space-y-4">
          <Callout
            variant="note"
            title={t(
              "help.gettingStarted.troubleshooting.localEndpoints.title",
            )}
          >
            {t("help.gettingStarted.troubleshooting.localEndpoints.body")}
          </Callout>
          <Callout
            variant="warning"
            title={t(
              "help.gettingStarted.troubleshooting.missingOpenAiKey.title",
            )}
          >
            {t("help.gettingStarted.troubleshooting.missingOpenAiKey.body")}
          </Callout>
          <Callout
            variant="tip"
            title={t(
              "help.gettingStarted.troubleshooting.workingOffline.title",
            )}
          >
            {t("help.gettingStarted.troubleshooting.workingOffline.body")}
          </Callout>
        </div>
      </Section>
    </div>
  );
};
