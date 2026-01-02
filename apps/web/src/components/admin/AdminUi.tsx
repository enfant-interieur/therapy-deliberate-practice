import {
  forwardRef,
  type ButtonHTMLAttributes,
  type PropsWithChildren,
  type ReactNode,
  type HTMLAttributes
} from "react";

const baseInput =
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-teal-400/70 focus:outline-none focus:ring-2 focus:ring-teal-500/30";

export const Card = ({
  children,
  className = "",
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={`rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950/60 via-slate-950/40 to-slate-950/70 shadow-[0_0_30px_rgba(15,23,42,0.35)] ${className}`}
    {...props}
  >
    {children}
  </div>
);

export const SectionHeader = ({
  kicker,
  title,
  subtitle
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) => (
  <div className="space-y-1">
    {kicker && (
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
        {kicker}
      </p>
    )}
    <h2 className="text-xl font-semibold text-white md:text-2xl">{title}</h2>
    {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
  </div>
);

export const Label = ({ children }: PropsWithChildren) => (
  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
    {children}
  </label>
);

export const Input = ({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`${baseInput} ${className}`} {...props} />
);

export const Textarea = ({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={`${baseInput} min-h-[120px] resize-y ${className}`} {...props} />
);

export const Select = ({ className = "", ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={`${baseInput} ${className}`} {...props} />
);

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-teal-500/40 disabled:cursor-not-allowed disabled:opacity-60";

const buttonVariants: Record<string, string> = {
  primary:
    "bg-teal-400/90 text-slate-950 hover:bg-teal-300 shadow-[0_0_20px_rgba(45,212,191,0.35)]",
  secondary: "border border-white/10 bg-slate-900/60 text-white hover:bg-slate-800/60",
  ghost: "text-slate-200 hover:bg-white/5",
  danger:
    "border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:text-white"
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof buttonVariants }
>(({ variant = "secondary", className = "", ...props }, ref) => (
  <button
    ref={ref}
    className={`${buttonBase} ${buttonVariants[variant]} ${className}`}
    {...props}
  />
));
Button.displayName = "Button";

export const IconButton = ({
  variant = "ghost",
  className = "",
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof buttonVariants;
  icon: ReactNode;
  label: string;
}) => (
  <button
    aria-label={label}
    className={`${buttonBase} h-9 w-9 rounded-full px-0 ${buttonVariants[variant]} ${className}`}
    {...props}
  >
    {icon}
  </button>
);

export const Badge = ({ children, className = "" }: PropsWithChildren<{ className?: string }>) => (
  <span
    className={`rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 ${className}`}
  >
    {children}
  </span>
);

export const Divider = () => <div className="h-px w-full bg-white/5" />;
