import { useParams, Link } from "react-router-dom";
import { useGetExerciseQuery } from "../store/api";

export const ExerciseDetailPage = () => {
  const { id } = useParams();
  const { data, isLoading } = useGetExerciseQuery(id ?? "");

  if (isLoading) {
    return <p className="text-sm text-slate-400">Loading exercise...</p>;
  }

  if (!data) {
    return <p className="text-sm text-slate-400">Exercise not found.</p>;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{data.skill_domain}</p>
        <h2 className="mt-2 text-3xl font-semibold">{data.title}</h2>
        <p className="mt-4 text-sm text-slate-300">{data.description}</p>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-200">
          <span className="rounded-full border border-white/10 px-3 py-1">Difficulty {data.difficulty}</span>
          {data.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 px-3 py-1">
              {tag}
            </span>
          ))}
        </div>
        <div className="mt-6 flex gap-3">
          <Link
            to={`/practice/${data.id}`}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
          >
            Start practice
          </Link>
          <Link
            to="/"
            className="rounded-full border border-white/20 px-4 py-2 text-sm"
          >
            Back to library
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">Patient scenario</h3>
          <p className="mt-3 text-sm text-slate-300">{data.example_prompt}</p>
          {data.example_good_response && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm">
              <p className="text-xs uppercase text-slate-400">Example response</p>
              <p className="mt-2 text-slate-200">{data.example_good_response}</p>
            </div>
          )}
        </div>
        <div className="rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">Objectives</h3>
          <div className="mt-4 space-y-4">
            {data.objectives.map((objective) => (
              <div key={objective.id} className="rounded-2xl border border-white/10 p-4">
                <p className="font-semibold">{objective.label}</p>
                <p className="text-sm text-slate-300">{objective.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};
