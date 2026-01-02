import type { ReactNode } from "react";

const variantStyles = {
  tip: {
    container: "border-teal-400/30 bg-teal-400/10 text-teal-100",
    icon: "text-teal-300",
    label: "Tip"
  },
  note: {
    container: "border-sky-400/30 bg-sky-400/10 text-sky-100",
    icon: "text-sky-300",
    label: "Note"
  },
  warning: {
    container: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    icon: "text-amber-300",
    label: "Warning"
  }
} as const;

type CalloutVariant = keyof typeof variantStyles;

type CalloutProps = {
  variant?: CalloutVariant;
  title?: string;
  children: ReactNode;
};

export const Callout = ({ variant = "note", title, children }: CalloutProps) => {
  const styles = variantStyles[variant];

  return (
    <div
      className={`flex gap-4 rounded-2xl border px-4 py-4 shadow-lg shadow-black/10 ${styles.container}`}
      role="note"
    >
      <span className={`mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 ${styles.icon}`}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <div className="space-y-1 text-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
          {title ?? styles.label}
        </p>
        <div className="text-sm leading-relaxed text-white/90">{children}</div>
      </div>
    </div>
  );
};
