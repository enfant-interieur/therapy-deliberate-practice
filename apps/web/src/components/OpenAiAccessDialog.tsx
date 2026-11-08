import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { OpenAiAccessIssue } from "@deliberate/shared";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";

type OpenAiAccessDialogProps = {
  issue: OpenAiAccessIssue | null;
  onClose: () => void;
};

export const OpenAiAccessDialog = ({
  issue,
  onClose,
}: OpenAiAccessDialogProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(Boolean(issue), onClose);
  const descriptionId = useId();
  if (!issue) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-[1.75rem] border border-violet-200/25 bg-[#242035] p-6 text-slate-50 shadow-2xl sm:p-8"
      >
        <span className="inline-flex rounded-full bg-[#3c3153] px-3 py-1 text-xs font-semibold text-violet-100">
          {t("settings.openAi.title")}
        </span>
        <h2 id={titleId} className="mt-4 text-2xl font-semibold tracking-tight">
          {t(`practice.openAiAccess.${issue}.title`)}
        </h2>
        <div
          id={descriptionId}
          className="mt-3 space-y-3 text-sm leading-relaxed text-slate-200"
        >
          <p>{t(`practice.openAiAccess.${issue}.description`)}</p>
          <p>{t("practice.openAiAccess.settingsHint")}</p>
        </div>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <a
            data-dialog-autofocus
            href="/settings#openai-key"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-[#ffc2a4] px-5 py-2 text-center text-sm font-semibold text-slate-950 hover:bg-[#ffd0b9] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-200"
          >
            {t("practice.openAiAccess.openSettings")}
          </a>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-full px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-200"
          >
            {t("practice.openAiAccess.stay")}
          </button>
        </div>
      </div>
    </div>
  );
};
