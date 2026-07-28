import { useTranslation } from "react-i18next";
import type { TaskSelectionState } from "./TaskSelectionStep";
import type { PlayerDraft, TeamDraft } from "./PlayersTeamsStep";

type ReviewStartStepProps = {
  mode: "ffa" | "tdm";
  taskSelection: TaskSelectionState;
  visibilityMode: "normal" | "hard" | "extreme";
  players: PlayerDraft[];
  teams: TeamDraft[];
  roundsPerPlayer: number;
};

export const ReviewStartStep = ({
  mode,
  taskSelection,
  visibilityMode,
  players,
  teams,
  roundsPerPlayer,
}: ReviewStartStepProps) => {
  const { t } = useTranslation();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
          {t("minigameUi.gameMode")}
        </p>
        <p className="mt-2 text-lg font-semibold text-white">
          {mode === "tdm"
            ? t("minigameUi.teamDeathmatch")
            : t("minigameUi.freeForAll")}
        </p>
        <p className="mt-3 text-xs text-slate-300">
          {t("minigameUi.visibilityValue", { value: visibilityMode })}
        </p>
        {mode === "tdm" && (
          <p className="mt-1 text-xs text-slate-300">
            {t("minigameUi.roundsPerPlayerValue", { count: roundsPerPlayer })}
          </p>
        )}
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
          {t("minigameUi.taskSelection")}
        </p>
        <p className="mt-2 text-sm text-white">
          {t("minigameUi.strategyValue", {
            value: t(`minigameUi.strategy.${taskSelection.strategy}`),
          })}
        </p>
        {taskSelection.task_ids?.length ? (
          <p className="mt-2 text-xs text-slate-300">
            {t("minigameUi.manualTasksValue", {
              count: taskSelection.task_ids.length,
            })}
          </p>
        ) : null}
        {taskSelection.tags?.length ? (
          <p className="mt-2 text-xs text-slate-300">
            {t("minigameUi.tagsValue", {
              value: taskSelection.tags.join(", "),
            })}
          </p>
        ) : null}
        {taskSelection.skill_domains?.length ? (
          <p className="mt-2 text-xs text-slate-300">
            {t("minigameUi.domainsValue", {
              value: taskSelection.skill_domains.join(", "),
            })}
          </p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
          {t("minigameUi.players")}
        </p>
        <div className="mt-2 space-y-1 text-xs text-slate-200">
          {players.map((player) => (
            <div key={player.id} className="flex items-center justify-between">
              <span>{player.name}</span>
              <span className="text-slate-400">{player.avatar}</span>
            </div>
          ))}
        </div>
      </div>
      {mode === "tdm" && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-300">
            {t("minigameUi.teams")}
          </p>
          <div className="mt-2 space-y-1 text-xs text-slate-200">
            {teams.map((team) => (
              <div key={team.id} className="flex items-center justify-between">
                <span>{team.name}</span>
                <span className="text-slate-400">{team.color}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
