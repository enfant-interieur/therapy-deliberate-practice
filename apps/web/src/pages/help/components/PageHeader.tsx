import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  subtitle: string;
  kicker?: string;
  actions?: ReactNode;
};

export const PageHeader = ({
  title,
  subtitle,
  kicker,
  actions,
}: PageHeaderProps) => {
  return (
    <div className="studio-hero">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          {kicker ? (
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
              {kicker}
            </p>
          ) : null}
          <h1 className="studio-heading text-4xl text-white sm:text-5xl">
            {title}
          </h1>
          <p className="max-w-2xl text-sm text-slate-300 sm:text-base">
            {subtitle}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
      </div>
    </div>
  );
};
