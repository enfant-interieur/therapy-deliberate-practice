import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  MinigamePlayer,
  MinigameRound,
  MinigameRoundResult,
} from "../../../store/api";
import { RoundResponseCard } from "./RoundResponseCard";

type RoundsAccordionProps = {
  rounds: MinigameRound[];
  players: MinigamePlayer[];
  results: MinigameRoundResult[];
};

export const RoundsAccordion = ({
  rounds,
  players,
  results,
}: RoundsAccordionProps) => {
  const { t } = useTranslation();
  const [openRoundId, setOpenRoundId] = useState<string | null>(
    rounds[0]?.id ?? null,
  );

  return (
    <div className="space-y-3">
      {rounds.map((round) => {
        const isOpen = openRoundId === round.id;
        const player = players.find((entry) => entry.id === round.player_a_id);
        const result = results.find(
          (entry) =>
            entry.round_id === round.id &&
            entry.player_id === round.player_a_id,
        );
        return (
          <div
            key={round.id}
            className="rounded-3xl border border-white/10 bg-slate-900/60 p-4"
          >
            <button
              onClick={() => setOpenRoundId(isOpen ? null : round.id)}
              className="flex w-full items-center justify-between text-left"
              aria-expanded={isOpen}
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                  {t("minigameUi.numberedRound", {
                    number: round.position + 1,
                  })}
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {player?.name ?? t("minigameUi.player")} · {round.status}
                </p>
              </div>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-white/70">
                {isOpen ? t("minigameUi.collapse") : t("minigameUi.expand")}
              </span>
            </button>
            {isOpen && (
              <div className="mt-4">
                <RoundResponseCard
                  round={round}
                  player={player}
                  result={result}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
