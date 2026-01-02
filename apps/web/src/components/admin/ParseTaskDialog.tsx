import { useEffect, useRef, useState } from "react";
import type { DeliberatePracticeTaskV2, ParseMode } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Button, Label, Textarea, Input, Select } from "./AdminUi";

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
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
  onImport
}: ParseTaskDialogProps) => {
  const { t } = useTranslation();
  const [freeText, setFreeText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [parseMode, setParseMode] = useState<ParseMode>("original");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeliberatePracticeTaskV2 | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleClose = () => {
    setFreeText("");
    setSourceUrl("");
    setParseMode("original");
    setResult(null);
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const firstInput = containerRef.current?.querySelector<HTMLElement>(
      "textarea, input, button"
    );
    firstInput?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          containerRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])'
          ) ?? []
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open]);

  if (!open) return null;

  const handleParse = async () => {
    setError(null);
    const parsed = await onParse({
      free_text: freeText || undefined,
      source_url: sourceUrl || undefined,
      parse_mode: parseMode
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{t("admin.parse.title")}</h3>
            <p className="text-sm text-slate-400">{t("admin.parse.subtitle")}</p>
          </div>
          <Button variant="ghost" onClick={handleClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label>{t("admin.createFromText.placeholderText")}</Label>
            <Textarea
              className="min-h-[140px]"
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>{t("admin.createFromText.placeholderUrl")}</Label>
            <Input value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Parse mode</Label>
            <Select value={parseMode} onChange={(event) => setParseMode(event.target.value as ParseMode)}>
              <option value="original">Original Generation</option>
              <option value="exact">Exact parsing</option>
            </Select>
          </div>
        </div>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button variant="primary" onClick={handleParse} disabled={isParsing}>
            {isParsing ? t("admin.createFromText.parsing") : t("admin.createFromText.parse")}
          </Button>
        </div>
        {result && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SummaryRow label={t("admin.task.titleLabel")} value={result.task.title} />
              <SummaryRow label={t("admin.task.skillDomainLabel")} value={result.task.skill_domain} />
              <SummaryRow
                label={t("admin.task.difficultyLabel")}
                value={String(result.task.base_difficulty)}
              />
              <SummaryRow
                label={t("admin.content.criteria")}
                value={String(result.criteria.length)}
              />
              <SummaryRow label="Language" value={result.task.language ?? "en"} />
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" onClick={handleImport} disabled={isImporting}>
                {isImporting ? t("admin.task.importing") : t("admin.task.import")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
