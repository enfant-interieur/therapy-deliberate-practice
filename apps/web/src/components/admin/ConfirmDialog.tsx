import { useEffect, useRef } from "react";
import { Button } from "./AdminUi";

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
  tone = "default"
}: ConfirmDialogProps) => {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const secondaryRef = useRef<HTMLButtonElement | null>(null);

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
        const focusable = [
          confirmRef.current,
          secondaryRef.current,
          cancelRef.current
        ].filter(Boolean) as HTMLElement[];
        if (!focusable.length) return;
        const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
        let nextIndex = currentIndex;
        if (event.shiftKey) {
          nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
        }
        focusable[nextIndex]?.focus();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        {description && <p className="mt-2 text-sm text-slate-400">{description}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          {secondaryLabel && onSecondary && (
            <Button ref={secondaryRef} variant="secondary" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
          <Button
            ref={confirmRef}
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
