import { useEffect, useRef, useState } from "react";
import type { DeliberatePracticeTaskV2 } from "@deliberate/shared";
import { deliberatePracticeTaskV2Schema } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { Button, Label, Textarea } from "./AdminUi";

type ImportTaskDialogProps = {
  open: boolean;
  isImporting: boolean;
  onClose: () => void;
  onImport: (payload: DeliberatePracticeTaskV2) => Promise<void>;
};

export const ImportTaskDialog = ({ open, isImporting, onClose, onImport }: ImportTaskDialogProps) => {
  const { t } = useTranslation();
  const [jsonValue, setJsonValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleClose = () => {
    setJsonValue("");
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const firstInput = containerRef.current?.querySelector<HTMLElement>(
      "textarea, button"
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

  const handleImport = async () => {
    try {
      const parsed = JSON.parse(jsonValue);
      const validated = deliberatePracticeTaskV2Schema.parse(parsed);
      await onImport(validated);
      handleClose();
    } catch (err) {
      setError((err as Error).message ?? t("admin.task.invalidJson"));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{t("admin.import.title")}</h3>
            <p className="text-sm text-slate-400">{t("admin.import.subtitle")}</p>
          </div>
          <Button variant="ghost" onClick={handleClose}>
            {t("admin.actions.close")}
          </Button>
        </div>
        <div className="mt-6 space-y-2">
          <Label>{t("admin.import.jsonLabel")}</Label>
          <Textarea
            className="min-h-[240px] font-mono text-xs"
            value={jsonValue}
            onChange={(event) => setJsonValue(event.target.value)}
          />
        </div>
        {error && <p className="mt-3 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button variant="primary" onClick={handleImport} disabled={isImporting}>
            {isImporting ? t("admin.task.importing") : t("admin.task.import")}
          </Button>
        </div>
      </div>
    </div>
  );
};
