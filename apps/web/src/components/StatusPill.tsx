import { Spinner } from "./Spinner";

type StatusTone = "info" | "success" | "warning" | "danger";

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
  showSpinner?: boolean;
  spinnerTone?: "teal" | "slate" | "rose" | "amber";
};

const toneStyles: Record<StatusTone, string> = {
  info: "border-teal-300/40 bg-teal-400/10 text-teal-100",
  success: "border-emerald-300/40 bg-emerald-400/10 text-emerald-100",
  warning: "border-amber-300/40 bg-amber-400/10 text-amber-100",
  danger: "border-rose-300/40 bg-rose-500/10 text-rose-100"
};

export const StatusPill = ({
  label,
  tone = "info",
  showSpinner = false,
  spinnerTone = "teal"
}: StatusPillProps) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] ${toneStyles[tone]}`}
  >
    {showSpinner && <Spinner size="xs" tone={spinnerTone} />}
    <span>{label}</span>
  </span>
);
