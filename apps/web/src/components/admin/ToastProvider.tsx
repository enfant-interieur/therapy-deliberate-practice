import { createContext, useCallback, useContext, useMemo, useState, type PropsWithChildren } from "react";

export type ToastTone = "success" | "error" | "info" | "warning";

export type Toast = {
  id: string;
  title: string;
  message?: string;
  tone: ToastTone;
};

type ToastContextValue = {
  pushToast: (toast: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { ...toast, id }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed right-6 top-24 z-50 flex w-[320px] flex-col gap-3"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              toast.tone === "success"
                ? "border-teal-400/40 bg-slate-950/80 text-teal-100"
                : toast.tone === "error"
                  ? "border-rose-400/40 bg-slate-950/80 text-rose-100"
                  : toast.tone === "warning"
                    ? "border-amber-400/40 bg-slate-950/80 text-amber-100"
                    : "border-slate-400/30 bg-slate-950/80 text-slate-100"
            }`}
          >
            <p className="font-semibold">{toast.title}</p>
            {toast.message && <p className="mt-1 text-xs text-slate-300">{toast.message}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
};
