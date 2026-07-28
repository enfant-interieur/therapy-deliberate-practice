import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../hooks/useAccessibleDialog";

type DrawerProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
};

export const Drawer = ({ open, onClose, children, ariaLabel }: DrawerProps) => {
  const { t } = useTranslation();
  const { dialogRef } = useAccessibleDialog(open, onClose);
  useEffect(() => {
    if (!open) return undefined;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer bg-slate-950/80 backdrop-blur"
        aria-label={t("drawer.close")}
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? t("drawer.navigation")}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-white/10 bg-slate-950/95 px-6 py-6 shadow-2xl shadow-black/40 transition-transform duration-300 ease-out sm:max-w-sm"
      >
        {children}
      </div>
    </div>
  );
};
