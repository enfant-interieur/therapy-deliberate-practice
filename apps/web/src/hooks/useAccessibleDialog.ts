import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const isTopmostDialog = (dialog: HTMLElement) => {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  );
  return dialogs[dialogs.length - 1] === dialog;
};

export const useAccessibleDialog = (open: boolean, onDismiss?: () => void) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const invokerRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);
  const titleId = useId();

  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    invokerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusInitial = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostDialog(dialog)) return;
      const target =
        dialog.querySelector<HTMLElement>("[data-dialog-autofocus]") ??
        dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        dialog;
      target.focus();
    });

    const handleKeydown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || !isTopmostDialog(dialog)) return;

      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || !dialog.contains(active))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("keydown", handleKeydown);
      const invoker = invokerRef.current;
      if (invoker?.isConnected) {
        window.requestAnimationFrame(() => invoker.focus());
      }
    };
  }, [open]);

  return { dialogRef, titleId };
};
