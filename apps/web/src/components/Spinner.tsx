type SpinnerProps = {
  size?: "xs" | "sm" | "md";
  tone?: "teal" | "slate" | "rose" | "amber";
};

const sizeStyles: Record<NonNullable<SpinnerProps["size"]>, string> = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-5 w-5 border-2"
};

const toneStyles: Record<NonNullable<SpinnerProps["tone"]>, string> = {
  teal: "border-teal-200/80 border-t-transparent",
  slate: "border-slate-300/80 border-t-transparent",
  rose: "border-rose-200/80 border-t-transparent",
  amber: "border-amber-200/80 border-t-transparent"
};

export const Spinner = ({ size = "xs", tone = "teal" }: SpinnerProps) => (
  <span
    className={`inline-block animate-spin rounded-full ${sizeStyles[size]} ${toneStyles[tone]}`}
    aria-hidden="true"
  />
);
