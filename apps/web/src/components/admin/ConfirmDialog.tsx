import { Button } from "./AdminUi";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  secondaryLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onSecondary?: () => void;
  tone?: "danger" | "default";
};

export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  onConfirm,
  onCancel,
  onSecondary,
  tone = "default",
}: ConfirmDialogProps) => {
  const { dialogRef, titleId } = useAccessibleDialog(open, onCancel);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <h3 id={titleId} className="text-lg font-semibold text-white">
          {title}
        </h3>
        {description && (
          <p className="mt-2 text-sm text-slate-400">{description}</p>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button data-dialog-autofocus variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {secondaryLabel && onSecondary && (
            <Button variant="secondary" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};
