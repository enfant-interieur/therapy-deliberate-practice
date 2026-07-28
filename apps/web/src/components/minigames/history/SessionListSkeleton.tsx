export const SessionListSkeleton = () => (
  <div className="space-y-4">
    {Array.from({ length: 3 }).map((_, index) => (
      <div
        key={`skeleton-${index}`}
        className="animate-pulse rounded-3xl border border-white/10 bg-slate-900/40 p-5"
      >
        <div className="flex items-center justify-between">
          <div className="h-4 w-24 rounded-full bg-white/10" />
          <div className="h-8 w-24 rounded-full bg-white/10" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((__, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              className="h-10 rounded-2xl bg-white/5"
            />
          ))}
        </div>
      </div>
    ))}
  </div>
);
