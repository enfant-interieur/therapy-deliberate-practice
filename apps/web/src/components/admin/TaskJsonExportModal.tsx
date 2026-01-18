import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./AdminUi";

type TaskJsonExportModalProps = {
  open: boolean;
  json: string;
  onClose: () => void;
  onCopy?: () => void;
};

export const TaskJsonExportModal = ({ open, json, onClose, onCopy }: TaskJsonExportModalProps) => {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      onCopy?.();
    } catch (error) {
      console.error("Failed to copy JSON", error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur">
      <div className="w-full max-w-3xl rounded-2xl border border-white/10 bg-slate-950/95 p-6 shadow-2xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
              {t("admin.edit.exportModalKicker")}
            </p>
            <h3 className="text-xl font-semibold text-white">{t("admin.edit.exportModalTitle")}</h3>
            <p className="text-sm text-slate-400">{t("admin.edit.exportModalSubtitle")}</p>
          </div>
          <Button variant="ghost" onClick={onClose}>
            {t("admin.actions.close")}
          </Button>
        </div>

        <div className="relative mt-6">
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/10"
            onClick={handleCopy}
          >
            {t("admin.actions.copyCode")}
          </button>
          <pre className="max-h-[480px] overflow-auto rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-left text-xs text-teal-50">
            <code>{json}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
