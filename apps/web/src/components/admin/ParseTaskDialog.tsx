import { useCallback, useState } from "react";
import type { DeliberatePracticeTaskV2, ParseMode } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Textarea, Select } from "./AdminUi";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
      {label}
    </p>
    <p className="text-sm text-white">{value}</p>
  </div>
);

type ParseTaskDialogProps = {
  open: boolean;
  isParsing: boolean;
  isImporting: boolean;
  onClose: () => void;
  onParse: (payload: {
    free_text?: string;
    source_url?: string;
    parse_mode?: ParseMode;
  }) => Promise<DeliberatePracticeTaskV2 | null>;
  onImport: (payload: DeliberatePracticeTaskV2) => Promise<void>;
};

export const ParseTaskDialog = ({
  open,
  isParsing,
  isImporting,
  onClose,
  onParse,
  onImport,
}: ParseTaskDialogProps) => {
  const { t } = useTranslation();
  const [freeText, setFreeText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [parseMode, setParseMode] = useState<ParseMode>("original");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeliberatePracticeTaskV2 | null>(null);
  const isPartialPrompt = parseMode === "partial_prompt";
  const freeTextLabel = isPartialPrompt
    ? t("admin.parse.inputs.instructionPrompt")
    : t("admin.createFromText.placeholderText");

  const handleClose = useCallback(() => {
    setFreeText("");
    setSourceUrl("");
    setParseMode("original");
    setResult(null);
    setError(null);
    onClose();
  }, [onClose]);

  const { dialogRef, titleId } = useAccessibleDialog(open, handleClose);

  if (!open) return null;

  const clearParsedResult = () => {
    setResult(null);
    setError(null);
  };

  const handleFreeTextChange = (value: string) => {
    setFreeText(value);
    if (value.trim()) setSourceUrl("");
    clearParsedResult();
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    if (value.trim()) setFreeText("");
    clearParsedResult();
  };

  const handleParseModeChange = (nextMode: ParseMode) => {
    setParseMode(nextMode);
    if (nextMode === "partial_prompt") setSourceUrl("");
    clearParsedResult();
  };

  const handleParse = async () => {
    setError(null);
    const parsed = await onParse({
      free_text: freeText || undefined,
      source_url: sourceUrl || undefined,
      parse_mode: parseMode,
    });
    if (!parsed) {
      setError(t("admin.createFromText.errorFallback"));
      return;
    }
    setResult(parsed);
  };

  const handleImport = async () => {
    if (!result) return;
    await onImport(result);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-white">
              {t("admin.parse.title")}
            </h3>
            <p className="text-sm text-slate-400">
              {t("admin.parse.subtitle")}
            </p>
          </div>
          <Button variant="ghost" onClick={handleClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="parse-task-text">{freeTextLabel}</Label>
            <Textarea
              id="parse-task-text"
              data-dialog-autofocus
              className="min-h-[140px]"
              value={freeText}
              onChange={(event) => handleFreeTextChange(event.target.value)}
            />
            {isPartialPrompt && (
              <p className="text-xs text-slate-400">
                {t("admin.parse.inputs.instructionHint")}
              </p>
            )}
          </div>
          {!isPartialPrompt && (
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="parse-task-source-url">
                {t("admin.parse.inputs.sourceUrl")}
              </Label>
              <Input
                id="parse-task-source-url"
                value={sourceUrl}
                onChange={(event) =>
                  handleSourceUrlChange(event.target.value)
                }
                placeholder="https://"
              />
              <p className="text-xs text-slate-400">
                {t("admin.parse.inputs.sourceChoiceHint")}
              </p>
            </div>
          )}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="parse-task-mode">
              {t("admin.parse.inputs.parseMode")}
            </Label>
            <Select
              id="parse-task-mode"
              aria-label={t("admin.parse.inputs.parseMode")}
              value={parseMode}
              onChange={(event) =>
                handleParseModeChange(event.target.value as ParseMode)
              }
            >
              <option value="original">{t("admin.parse.mode.original")}</option>
              <option value="exact">{t("admin.parse.mode.exact")}</option>
              <option value="partial_prompt">
                {t("admin.parse.mode.partialPrompt")}
              </option>
            </Select>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button variant="primary" onClick={handleParse} disabled={isParsing}>
            {isParsing
              ? t("admin.createFromText.parsing")
              : t("admin.createFromText.parse")}
          </Button>
        </div>
        {result && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SummaryRow
                label={t("admin.task.titleLabel")}
                value={result.task.title}
              />
              <SummaryRow
                label={t("admin.task.skillDomainLabel")}
                value={result.task.skill_domain}
              />
              <SummaryRow
                label={t("admin.task.difficultyLabel")}
                value={String(result.task.base_difficulty)}
              />
              <SummaryRow
                label={t("admin.content.criteria")}
                value={String(result.criteria.length)}
              />
              <SummaryRow
                label={t("admin.task.languageLabel")}
                value={result.task.language ?? "en"}
              />
            </div>
            <div className="mt-4 flex justify-end">
              <Button
                variant="primary"
                onClick={handleImport}
                disabled={isImporting}
              >
                {isImporting
                  ? t("admin.task.importing")
                  : t("admin.task.import")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
