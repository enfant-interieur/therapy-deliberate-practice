import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Label, Select } from "./AdminUi";

type TranslateTaskDialogProps = {
  open: boolean;
  currentLanguage: string;
  targetLanguage: string;
  onTargetLanguageChange: (language: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
};

export const TranslateTaskDialog = ({
  open,
  currentLanguage,
  targetLanguage,
  onTargetLanguageChange,
  onConfirm,
  onCancel,
  isLoading = false
}: TranslateTaskDialogProps) => {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
      if (event.key === "Tab") {
        const focusable = [confirmRef.current, cancelRef.current].filter(Boolean) as HTMLElement[];
        if (!focusable.length) return;
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0
            ? focusable.length - 1
            : currentIndex - 1
          : currentIndex === focusable.length - 1
            ? 0
            : currentIndex + 1;
        focusable[nextIndex]?.focus();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  const isInvalid = targetLanguage === currentLanguage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-white">{t("admin.translate.title")}</h3>
          <p className="text-sm text-slate-400">{t("admin.translate.description")}</p>
        </div>
        <div className="space-y-2">
          <Label>{t("admin.translate.languageLabel")}</Label>
          <Select
            value={targetLanguage}
            onChange={(event) => onTargetLanguageChange(event.target.value)}
          >
            <option value="en">{t("appShell.language.english")}</option>
            <option value="fr">{t("appShell.language.french")}</option>
          </Select>
          {isInvalid && (
            <p className="text-xs text-rose-300">{t("admin.translate.sameLanguageError")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {t("admin.actions.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            variant="primary"
            onClick={onConfirm}
            disabled={isInvalid || isLoading}
          >
            {isLoading ? t("admin.translate.translating") : t("admin.actions.translate")}
          </Button>
        </div>
      </div>
    </div>
  );
};
