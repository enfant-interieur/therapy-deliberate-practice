import { useState } from "react";
import { Link } from "react-router-dom";
import { useGetExercisesQuery } from "../store/api";

export const LibraryPage = () => {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useGetExercisesQuery({ q: search });

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Exercise Library</h2>
            <p className="text-sm text-slate-300">
              Choose a deliberate practice scenario and refine micro-skills with guided feedback.
            </p>
          </div>
          <div className="flex gap-2">
            <input
              className="rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
              placeholder="Search exercises"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        {isLoading && <p className="text-sm text-slate-400">Loading exercises...</p>}
        {data?.map((exercise) => (
          <article
            key={exercise.id}
            className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{exercise.skill_domain}</p>
                <h3 className="text-xl font-semibold">{exercise.title}</h3>
              </div>
              <span className="rounded-full bg-teal-500/10 px-3 py-1 text-xs text-teal-200">
                Difficulty {exercise.difficulty}
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-300">{exercise.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {exercise.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-white/10 px-3 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <Link
                to={`/exercises/${exercise.id}`}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
              >
                View details
              </Link>
              <Link
                to={`/practice/${exercise.id}`}
                className="rounded-full border border-white/20 px-4 py-2 text-sm"
              >
                Start practice
              </Link>
            </div>
          </article>
        ))}
        {!isLoading && data?.length === 0 && (
          <p className="text-sm text-slate-400">No exercises found. Try a different search.</p>
        )}
      </section>
    </div>
  );
};
