import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetTasksQuery } from "../../store/api";

export type TaskSelectionState = {
  strategy: "manual" | "random" | "filtered_random";
  task_ids?: string[];
  tags?: string[];
  skill_domains?: string[];
  shuffle: boolean;
  seed: string;
};

type TaskSelectionStepProps = {
  value: TaskSelectionState;
  onChange: (next: TaskSelectionState) => void;
};

export const TaskSelectionStep = ({
  value,
  onChange,
}: TaskSelectionStepProps) => {
  const { t } = useTranslation();
  const { data: tasks = [] } = useGetTasksQuery({ published: 1 });
  const tags = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .flatMap((task) => (task.tags ?? []) as string[])
            .filter(Boolean),
        ),
      ),
    [tasks],
  );
  const skillDomains = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.skill_domain).filter(Boolean)),
      ),
    [tasks],
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-white">
          {t("minigameUi.taskStrategy")}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          {(["manual", "random", "filtered_random"] as const).map(
            (strategy) => (
              <button
                key={strategy}
                onClick={() =>
                  onChange({
                    ...value,
                    strategy,
                    task_ids:
                      strategy === "manual"
                        ? (value.task_ids ?? [])
                        : undefined,
                  })
                }
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide ${
                  value.strategy === strategy
                    ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                    : "border-white/10 bg-white/5 text-white/70 hover:border-white/40"
                }`}
              >
                {t(`minigameUi.strategy.${strategy}`)}
              </button>
            ),
          )}
        </div>
      </div>
      {value.strategy === "manual" && (
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
            {t("minigameUi.pickTasks")}
          </p>
          <div className="mt-3 max-h-56 space-y-2 overflow-auto rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            {tasks.map((task) => {
              const checked = value.task_ids?.includes(task.id) ?? false;
              return (
                <label
                  key={task.id}
                  className="flex items-center gap-3 text-sm text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = new Set(value.task_ids ?? []);
                      if (event.target.checked) {
                        next.add(task.id);
                      } else {
                        next.delete(task.id);
                      }
                      onChange({ ...value, task_ids: Array.from(next) });
                    }}
                    className="h-4 w-4 rounded border-white/20 bg-slate-950 text-teal-400"
                  />
                  <span>{task.title}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {value.strategy === "filtered_random" && (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
              {t("minigameUi.tags")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((tag) => {
                const active = value.tags?.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      const next = new Set(value.tags ?? []);
                      if (active) {
                        next.delete(tag);
                      } else {
                        next.add(tag);
                      }
                      onChange({ ...value, tags: Array.from(next) });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                        : "border-white/10 bg-white/5 text-white/70 hover:border-white/40"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
              {t("minigameUi.skillDomain")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {skillDomains.map((domain) => {
                const active = value.skill_domains?.includes(domain);
                return (
                  <button
                    key={domain}
                    onClick={() => {
                      const next = new Set(value.skill_domains ?? []);
                      if (active) {
                        next.delete(domain);
                      } else {
                        next.add(domain);
                      }
                      onChange({ ...value, skill_domains: Array.from(next) });
                    }}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                        : "border-white/10 bg-white/5 text-white/70 hover:border-white/40"
                    }`}
                  >
                    {domain}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <div>
          <p className="text-sm font-semibold text-white">
            {t("minigameUi.shuffleEachRound")}
          </p>
          <p className="text-xs text-slate-300">
            {t("minigameUi.shuffleDescription")}
          </p>
        </div>
        <button
          aria-label={t("minigameUi.shuffleEachRound")}
          aria-pressed={value.shuffle}
          onClick={() => onChange({ ...value, shuffle: !value.shuffle })}
          className={`relative inline-flex h-6 w-12 items-center rounded-full transition ${
            value.shuffle ? "bg-teal-400" : "bg-slate-700"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
              value.shuffle ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>
    </div>
  );
};
