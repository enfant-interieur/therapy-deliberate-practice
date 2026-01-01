import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useGetTasksQuery } from "../store/api";

export const LibraryPage = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const { data, isLoading } = useGetTasksQuery({ q: search, published: 1 });

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{t("library.title")}</h2>
            <p className="text-sm text-slate-300">{t("library.subtitle")}</p>
          </div>
          <div className="flex gap-2">
            <input
              className="rounded-full border border-white/10 bg-slate-950/60 px-4 py-2 text-sm text-white"
              placeholder={t("library.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        {isLoading && <p className="text-sm text-slate-400">{t("library.loading")}</p>}
        {data?.map((task) => (
          <article
            key={task.id}
            className="rounded-3xl border border-white/10 bg-slate-900/40 p-6 shadow-lg"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.3em] text-teal-300">{task.skill_domain}</p>
                <h3 className="text-xl font-semibold">{task.title}</h3>
              </div>
              <span className="rounded-full bg-teal-500/10 px-3 py-1 text-xs text-teal-200">
                {t("library.difficulty", { difficulty: task.base_difficulty })}
              </span>
            </div>
            <p className="mt-4 text-sm text-slate-300">{task.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {task.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-white/10 px-3 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <Link
                to={`/tasks/${task.id}`}
                className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-950"
              >
                {t("library.viewDetails")}
              </Link>
              <Link
                to={`/practice/${task.id}`}
                className="rounded-full border border-white/20 px-4 py-2 text-sm"
              >
                {t("library.startPractice")}
              </Link>
            </div>
          </article>
        ))}
        {!isLoading && data?.length === 0 && (
          <p className="text-sm text-slate-400">{t("library.noResults")}</p>
        )}
      </section>
    </div>
  );
};
