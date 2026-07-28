import type {
  MinigamePlayer,
  MinigameRoundResult,
  MinigameTeam,
} from "../../../store/api";
import { useTranslation } from "react-i18next";
import { LeaderboardPanel } from "../LeaderboardPanel";

type SessionLeaderboardPanelProps = {
  mode: "ffa" | "tdm";
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  results: MinigameRoundResult[];
};

export const SessionLeaderboardPanel = ({
  mode,
  players,
  teams,
  results,
}: SessionLeaderboardPanelProps) => {
  const { t } = useTranslation();

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
      <LeaderboardPanel
        mode={mode}
        players={players}
        teams={teams}
        results={results}
        badgeLabel={t("minigameUi.final")}
      />
    </section>
  );
};
