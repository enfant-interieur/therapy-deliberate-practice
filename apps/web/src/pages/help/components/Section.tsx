import type { ReactNode } from "react";

type SectionProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export const Section = ({ title, subtitle, children }: SectionProps) => {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/50 p-6 shadow-xl shadow-black/20">
      <div className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle ? <p className="text-sm text-slate-300">{subtitle}</p> : null}
      </div>
      <div className="text-sm text-slate-200">{children}</div>
    </section>
  );
};
