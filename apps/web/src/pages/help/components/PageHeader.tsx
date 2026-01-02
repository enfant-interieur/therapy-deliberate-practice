import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle: string;
  kicker?: string;
  actions?: ReactNode;
};

export const PageHeader = ({ title, subtitle, kicker, actions }: PageHeaderProps) => {
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/70 via-slate-900/40 to-slate-950/80 p-6 shadow-2xl shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {kicker ? (
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">{kicker}</p>
          ) : null}
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
          <p className="max-w-2xl text-sm text-slate-300 sm:text-base">{subtitle}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
};
