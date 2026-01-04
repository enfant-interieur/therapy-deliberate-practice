import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type GuideMode = "intro" | "local" | "openai";

type StepLink = {
  label: string;
  href: string;
};

type StepCard = {
  title: string;
  description: string;
  bullets?: string[];
  code?: string;
  links?: StepLink[];
};

type AiSetupModalProps = {
  open: boolean;
  onClose: (reason: "skip" | "dismiss") => void;
};

const LinkIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    className="h-4 w-4 text-teal-200 transition group-hover:text-white"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M13 5h6m0 0v6m0-6L10 16" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" strokeLinecap="round" />
  </svg>
);

const StepIndicator = ({ total, current }: { total: number; current: number }) => {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }).map((_, index) => (
        <span
          key={`step-${index}`}
          className={`h-2 w-8 rounded-full transition-all duration-500 ${
            index === current ? "bg-teal-400 shadow-[0_0_18px_rgba(45,212,191,0.75)]" : "bg-white/10"
          }`}
        />
      ))}
    </div>
  );
};

const LinkButton = ({ label, href }: StepLink) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="group inline-flex items-center gap-2 rounded-full border border-teal-400/40 bg-teal-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-200 transition hover:-translate-y-0.5 hover:border-teal-300/80 hover:bg-teal-400/20"
  >
    {label}
    <LinkIcon />
  </a>
);

export const AiSetupModal = ({ open, onClose }: AiSetupModalProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<GuideMode>("intro");
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setMode("intro");
    setStepIndex(0);
  }, [open]);

  const introSteps = useMemo<StepCard[]>(
    () => [
      {
        title: t("aiSetup.intro.steps.0.title"),
        description: t("aiSetup.intro.steps.0.description"),
        bullets: [
          t("aiSetup.intro.steps.0.bullets.0"),
          t("aiSetup.intro.steps.0.bullets.1"),
          t("aiSetup.intro.steps.0.bullets.2")
        ]
      },
      {
        title: t("aiSetup.intro.steps.1.title"),
        description: t("aiSetup.intro.steps.1.description"),
        bullets: [
          t("aiSetup.intro.steps.1.bullets.0"),
          t("aiSetup.intro.steps.1.bullets.1"),
          t("aiSetup.intro.steps.1.bullets.2")
        ]
      },
      {
        title: t("aiSetup.intro.steps.2.title"),
        description: t("aiSetup.intro.steps.2.description"),
        bullets: [
          t("aiSetup.intro.steps.2.bullets.0"),
          t("aiSetup.intro.steps.2.bullets.1"),
          t("aiSetup.intro.steps.2.bullets.2")
        ]
      }
    ],
    [t]
  );

  const localSteps = useMemo<StepCard[]>(
    () => [
      {
        title: t("aiSetup.local.steps.0.title"),
        description: t("aiSetup.local.steps.0.description"),
        links: [
          {
            label: t("aiSetup.local.steps.0.links.0.label"),
            href: t("aiSetup.local.steps.0.links.0.href")
          }
        ]
      },
      {
        title: t("aiSetup.local.steps.1.title"),
        description: t("aiSetup.local.steps.1.description"),
        bullets: [
          t("aiSetup.local.steps.1.bullets.0"),
          t("aiSetup.local.steps.1.bullets.1"),
          t("aiSetup.local.steps.1.bullets.2")
        ],
        links: [
          {
            label: t("aiSetup.local.steps.1.links.0.label"),
            href: t("aiSetup.local.steps.1.links.0.href")
          },
          {
            label: t("aiSetup.local.steps.1.links.1.label"),
            href: t("aiSetup.local.steps.1.links.1.href")
          },
          {
            label: t("aiSetup.local.steps.1.links.2.label"),
            href: t("aiSetup.local.steps.1.links.2.href")
          }
        ]
      },
      {
        title: t("aiSetup.local.steps.2.title"),
        description: t("aiSetup.local.steps.2.description"),
        bullets: [
          t("aiSetup.local.steps.2.bullets.0"),
          t("aiSetup.local.steps.2.bullets.1"),
          t("aiSetup.local.steps.2.bullets.2")
        ],
        code: t("aiSetup.local.steps.2.code")
      }
    ],
    [t]
  );

  const openAiSteps = useMemo<StepCard[]>(
    () => [
      {
        title: t("aiSetup.openai.steps.0.title"),
        description: t("aiSetup.openai.steps.0.description"),
        bullets: [
          t("aiSetup.openai.steps.0.bullets.0"),
          t("aiSetup.openai.steps.0.bullets.1"),
          t("aiSetup.openai.steps.0.bullets.2")
        ],
        links: [
          {
            label: t("aiSetup.openai.steps.0.links.0.label"),
            href: t("aiSetup.openai.steps.0.links.0.href")
          },
          {
            label: t("aiSetup.openai.steps.0.links.1.label"),
            href: t("aiSetup.openai.steps.0.links.1.href")
          }
        ]
      },
      {
        title: t("aiSetup.openai.steps.1.title"),
        description: t("aiSetup.openai.steps.1.description"),
        bullets: [
          t("aiSetup.openai.steps.1.bullets.0"),
          t("aiSetup.openai.steps.1.bullets.1"),
          t("aiSetup.openai.steps.1.bullets.2")
        ],
        links: [
          {
            label: t("aiSetup.openai.steps.1.links.0.label"),
            href: t("aiSetup.openai.steps.1.links.0.href")
          },
          {
            label: t("aiSetup.openai.steps.1.links.1.label"),
            href: t("aiSetup.openai.steps.1.links.1.href")
          }
        ]
      },
      {
        title: t("aiSetup.openai.steps.2.title"),
        description: t("aiSetup.openai.steps.2.description"),
        bullets: [
          t("aiSetup.openai.steps.2.bullets.0"),
          t("aiSetup.openai.steps.2.bullets.1")
        ]
      }
    ],
    [t]
  );

  const steps = mode === "intro" ? introSteps : mode === "local" ? localSteps : openAiSteps;
  const totalSteps = steps.length;
  const currentStep = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 px-6 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.2),_transparent_60%)]" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-slate-950/80 shadow-[0_30px_120px_rgba(15,23,42,0.9)] backdrop-blur"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-8 py-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-teal-300">
              {t("aiSetup.title.kicker")}
            </p>
            <h2 className="text-2xl font-semibold text-white">{t("aiSetup.title.main")}</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">{t("aiSetup.title.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose("skip")}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/30 hover:text-white"
          >
            {t("aiSetup.actions.close")}
          </button>
        </div>

        <div className="grid gap-6 px-8 py-8 md:grid-cols-[1.15fr_0.85fr]">
          <div className="ai-setup-card flex flex-col gap-6 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-950/80 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.7)]">
            <div className="flex items-center justify-between gap-4">
              <p className="rounded-full border border-teal-400/40 bg-teal-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-teal-200">
                {t("aiSetup.stepsLabel", { current: stepIndex + 1, total: totalSteps })}
              </p>
              <StepIndicator total={totalSteps} current={stepIndex} />
            </div>

            <div className="space-y-4">
              <h3 className="text-xl font-semibold text-white">{currentStep.title}</h3>
              <p className="text-sm text-slate-200">{currentStep.description}</p>
              {currentStep.bullets && (
                <ul className="space-y-2 text-sm text-slate-300">
                  {currentStep.bullets.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-teal-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
              {currentStep.code && (
                <div className="rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 font-mono text-xs text-teal-200">
                  {currentStep.code}
                </div>
              )}
              {currentStep.links && (
                <div className="flex flex-wrap gap-2">
                  {currentStep.links.map((link) => (
                    <LinkButton key={link.href} {...link} />
                  ))}
                </div>
              )}
            </div>

            <div className="mt-auto flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => {
                  if (isFirst) return;
                  setStepIndex((value) => Math.max(0, value - 1));
                }}
                className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:border-white/5 disabled:text-slate-500"
                disabled={isFirst}
              >
                {t("aiSetup.actions.back")}
              </button>
              <div className="flex flex-wrap items-center gap-3">
                {mode === "openai" && isLast && (
                  <a
                    href="/settings#openai-key"
                    onClick={() => onClose("dismiss")}
                    className="group inline-flex items-center gap-2 rounded-full border border-teal-300/40 bg-teal-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 transition hover:-translate-y-0.5 hover:border-teal-200/80 hover:bg-teal-400/20"
                  >
                    {t("aiSetup.actions.openSettings")}
                    <span className="text-base text-teal-200 transition group-hover:translate-x-1">→</span>
                  </a>
                )}
                {mode !== "intro" && (
                  <button
                    type="button"
                    onClick={() => {
                      setMode("intro");
                      setStepIndex(0);
                    }}
                    className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-white/40 hover:text-white"
                  >
                    {t("aiSetup.actions.changePath")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (!isLast) {
                      setStepIndex((value) => Math.min(totalSteps - 1, value + 1));
                      return;
                    }
                    if (mode === "intro") {
                      document.getElementById("ai-setup-choice")?.scrollIntoView({
                        behavior: "smooth",
                        block: "center"
                      });
                      return;
                    }
                    if (mode !== "intro") {
                      onClose("dismiss");
                    }
                  }}
                  className="rounded-full bg-teal-400 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-slate-950 transition hover:-translate-y-0.5 hover:bg-teal-300"
                >
                  {mode === "intro" && isLast ? t("aiSetup.actions.choosePath") : t("aiSetup.actions.next")}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-[0_20px_50px_rgba(15,23,42,0.6)]">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
                {t("aiSetup.side.title")}
              </p>
              <h4 className="mt-3 text-lg font-semibold text-white">{t("aiSetup.side.subtitle")}</h4>
              <p className="mt-2 text-sm text-slate-300">{t("aiSetup.side.description")}</p>
              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-xs text-slate-300">
                <p className="font-semibold text-teal-200">{t("aiSetup.side.tipTitle")}</p>
                <p className="mt-2">{t("aiSetup.side.tipBody")}</p>
              </div>
            </div>

            {mode === "intro" && (
              <div
                id="ai-setup-choice"
                className="ai-setup-card flex flex-col gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-950/80 p-6"
              >
                <h4 className="text-lg font-semibold text-white">{t("aiSetup.choice.title")}</h4>
                <p className="text-sm text-slate-300">{t("aiSetup.choice.description")}</p>
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setMode("local");
                      setStepIndex(0);
                    }}
                    className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-teal-300/70 hover:bg-teal-400/10"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{t("aiSetup.choice.local.title")}</p>
                      <p className="text-xs text-slate-300">{t("aiSetup.choice.local.body")}</p>
                    </div>
                    <span className="text-teal-300 transition group-hover:translate-x-1">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("openai");
                      setStepIndex(0);
                    }}
                    className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left transition hover:border-teal-300/70 hover:bg-teal-400/10"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{t("aiSetup.choice.openai.title")}</p>
                      <p className="text-xs text-slate-300">{t("aiSetup.choice.openai.body")}</p>
                    </div>
                    <span className="text-teal-300 transition group-hover:translate-x-1">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onClose("skip")}
                    className="rounded-2xl border border-dashed border-white/20 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-300 transition hover:border-white/50 hover:text-white"
                  >
                    {t("aiSetup.choice.skip")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
