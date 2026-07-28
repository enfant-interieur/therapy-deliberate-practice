import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
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
  isLoading = false,
}: TranslateTaskDialogProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onCancel);

  if (!open) return null;

  const isInvalid = targetLanguage === currentLanguage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="space-y-2">
          <h3 id={titleId} className="text-lg font-semibold text-white">
            {t("admin.translate.title")}
          </h3>
          <p className="text-sm text-slate-400">
            {t("admin.translate.description")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="translate-task-language">
            {t("admin.translate.languageLabel")}
          </Label>
          <Select
            id="translate-task-language"
            data-dialog-autofocus
            value={targetLanguage}
            onChange={(event) => onTargetLanguageChange(event.target.value)}
          >
            <option value="en">{t("appShell.language.english")}</option>
            <option value="fr">{t("appShell.language.french")}</option>
          </Select>
          {isInvalid && (
            <p className="text-xs text-rose-300">
              {t("admin.translate.sameLanguageError")}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t("admin.actions.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isInvalid || isLoading}
          >
            {isLoading
              ? t("admin.translate.translating")
              : t("admin.actions.translate")}
          </Button>
        </div>
      </div>
    </div>
  );
};
