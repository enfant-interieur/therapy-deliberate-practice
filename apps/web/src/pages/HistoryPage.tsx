import { useGetAttemptsQuery } from "../store/api";
import { useAppSelector } from "../store/hooks";

export const HistoryPage = () => {
  const userId = useAppSelector((state) => state.auth.userId);
  const { data, isLoading } = useGetAttemptsQuery({ user_id: userId ?? undefined });

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <h2 className="text-2xl font-semibold">Practice history</h2>
        <p className="mt-2 text-sm text-slate-300">
          Track your progress across exercises and revisit past coaching highlights.
        </p>
      </section>
      <section className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
        {isLoading && <p className="text-sm text-slate-400">Loading attempts...</p>}
        {!isLoading && (!data || data.length === 0) && (
          <p className="text-sm text-slate-400">No attempts yet. Start a practice session.</p>
        )}
        <div className="space-y-4">
          {data?.map((attempt) => (
            <div
              key={attempt.id}
              className="flex items-center justify-between rounded-2xl border border-white/10 p-4"
            >
              <div>
                <p className="text-sm font-semibold">Exercise {attempt.exercise_id}</p>
                <p className="text-xs text-slate-400">Completed {attempt.completed_at}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold">Score {attempt.overall_score.toFixed(1)}</p>
                <p className={`text-xs ${attempt.overall_pass ? "text-emerald-300" : "text-rose-300"}`}>
                  {attempt.overall_pass ? "Passed" : "Needs work"}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
