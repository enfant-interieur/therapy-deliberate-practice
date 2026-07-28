type EmptyStateProps = {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
};

export const EmptyState = ({
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) => (
  <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-8 text-center">
    <h3 className="text-xl font-semibold text-white">{title}</h3>
    <p className="mt-2 text-sm text-slate-300">{description}</p>
    <button
      onClick={onAction}
      className="mt-6 rounded-full border border-teal-300/40 bg-teal-500/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-teal-100"
    >
      {actionLabel}
    </button>
  </div>
);
