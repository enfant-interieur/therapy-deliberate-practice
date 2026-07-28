import { useLocation, useParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGetTaskQuery } from "../store/api";

export const ExerciseDetailPage = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { id } = useParams();
  const { data, isLoading } = useGetTaskQuery({
    id: id ?? "",
    includeInteractions: true,
  });

  if (isLoading) {
    return <p className="text-sm text-slate-400">{t("exercise.loading")}</p>;
  }

  if (!data) {
    return <p className="text-sm text-slate-400">{t("exercise.notFound")}</p>;
  }

  const interactionExamples = data.interaction_examples ?? [];
  const authors = data.authors ?? [];
  const requestedLibraryReturnTo = (
    location.state as { libraryReturnTo?: unknown } | null
  )?.libraryReturnTo;
  const libraryReturnTo =
    typeof requestedLibraryReturnTo === "string" &&
    (requestedLibraryReturnTo === "/" ||
      requestedLibraryReturnTo.startsWith("/?"))
      ? requestedLibraryReturnTo
      : "/";

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-5 sm:p-8">
        <p className="break-words text-xs uppercase tracking-[0.3em] text-teal-300">
          {data.skill_domain}
        </p>
        <h2 className="mt-2 break-words text-3xl font-semibold">
          {data.title}
        </h2>
        <p className="mt-4 break-words text-sm text-slate-300">
          {data.description}
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-200">
          <span className="max-w-full break-words rounded-full border border-white/10 px-3 py-1">
            {t("exercise.difficulty", { difficulty: data.base_difficulty })}
          </span>
          {data.tags.map((tag) => (
            <span
              key={tag}
              className="max-w-full break-words rounded-full border border-white/10 px-3 py-1"
            >
              {tag}
            </span>
          ))}
        </div>
        {authors.length > 0 && (
          <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
              {t("exercise.authors")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {authors.map((author) => (
                <span
                  key={author}
                  className="rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-100"
                >
                  {author}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/practice/${data.id}`}
            state={{ libraryReturnTo }}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
          >
            {t("exercise.startPractice")}
          </Link>
          <Link
            to={libraryReturnTo}
            className="rounded-full border border-white/20 px-4 py-2 text-sm"
          >
            {t("exercise.backToLibrary")}
          </Link>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">
            {t("exercise.generalObjective")}
          </h3>
          <p className="mt-3 break-words text-sm text-slate-300">
            {data.general_objective ?? t("exercise.generalObjectiveEmpty")}
          </p>
          {data.example_counts && (
            <div className="mt-6">
              <p className="text-xs uppercase text-slate-400">
                {t("exercise.exampleCounts")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-200">
                {[1, 2, 3, 4, 5].map((level) => (
                  <span
                    key={level}
                    className="max-w-full break-words rounded-full border border-white/10 px-3 py-1"
                  >
                    {t("exercise.difficulty", { difficulty: level })}:{" "}
                    {data.example_counts?.[level] ?? 0}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 rounded-3xl border border-white/10 bg-slate-900/40 p-6">
          <h3 className="text-lg font-semibold">{t("exercise.criteria")}</h3>
          <div className="mt-4 space-y-4">
            {data.criteria?.map((criterion) => (
              <div
                key={criterion.id}
                className="min-w-0 break-words rounded-2xl border border-white/10 p-4"
              >
                <p className="font-semibold">{criterion.label}</p>
                <p className="text-sm text-slate-300">
                  {criterion.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/50 to-slate-800/40 p-5 shadow-xl backdrop-blur sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h3 className="text-2xl font-semibold">
              {t("exercise.answersTitle")}
            </h3>
            <p className="mt-1 text-sm text-slate-300">
              {t("exercise.answersSubtitle")}
            </p>
          </div>
        </div>
        <div className="mt-6 space-y-6">
          {interactionExamples.length ? (
            interactionExamples.map((example) => (
              <div
                key={example.id}
                className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 transition duration-300 hover:-translate-y-1 hover:border-teal-300/40 hover:shadow-2xl motion-reduce:transform-none motion-reduce:transition-none sm:p-6"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                  <span className="rounded-full bg-white/10 px-3 py-1">
                    {t("exercise.difficulty", {
                      difficulty: example.difficulty,
                    })}
                  </span>
                  {example.title && (
                    <span className="max-w-full break-words rounded-full border border-white/10 px-3 py-1 text-slate-300">
                      {example.title}
                    </span>
                  )}
                </div>
                <div className="mt-5 space-y-4 text-sm">
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-200">
                      <p className="text-xs uppercase tracking-wide text-slate-400">
                        {t("exercise.patient")}
                      </p>
                      <p className="mt-2 break-words">{example.patient_text}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl border border-teal-400/30 bg-teal-500/10 px-4 py-3 text-teal-50">
                      <p className="text-xs uppercase tracking-wide text-teal-200">
                        {t("exercise.therapist")}
                      </p>
                      <p className="mt-2 break-words">
                        {example.therapist_text}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-300">
              {t("exercise.noInteractionExamples")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
