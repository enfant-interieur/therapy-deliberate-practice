import i18n from "../../../i18n";
import type {
  MinigamePlayer,
  MinigameRoundResult,
  MinigameTeam,
} from "../../../store/api";

type WinnerKind = "player" | "team" | "tie" | "none";

export type WinnerSummary = {
  kind: WinnerKind;
  winnerIds: string[];
  label: string;
  subLabel?: string;
};

type WinnerInput = {
  mode: "ffa" | "tdm";
  players: MinigamePlayer[];
  teams: MinigameTeam[];
  results: MinigameRoundResult[];
};

const EPSILON = 0.001;

const closeEnough = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

const formatNameList = (names: string[], subject: "team" | "player") => {
  const conjunction = i18n.t("minigameUi.winner.conjunction");
  const joined =
    names.length <= 1
      ? (names[0] ?? "")
      : names.length === 2
        ? `${names[0]} ${conjunction} ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, ${conjunction} ${names[names.length - 1]}`;
  return i18n.t(`minigameUi.winner.${subject}Tie`, { names: joined });
};

const formatComparison = (topScore: number, nextScore?: number) => {
  if (typeof nextScore !== "number") {
    return i18n.t("minigameUi.winner.topScore", {
      score: topScore.toFixed(2),
    });
  }
  return i18n.t("minigameUi.winner.scoreComparison", {
    top: topScore.toFixed(2),
    next: nextScore.toFixed(2),
  });
};

type ScoreEntry = {
  id: string;
  name: string;
  total: number;
  average: number;
  rounds: number;
};

const sortEntries = (entries: ScoreEntry[]) =>
  [...entries].sort((a, b) => {
    if (!closeEnough(a.total, b.total)) return b.total - a.total;
    if (!closeEnough(a.average, b.average)) return b.average - a.average;
    if (a.rounds !== b.rounds) return b.rounds - a.rounds;
    return a.name.localeCompare(b.name);
  });

const getTiedEntries = (entries: ScoreEntry[], top: ScoreEntry) =>
  entries.filter(
    (entry) =>
      closeEnough(entry.total, top.total) &&
      closeEnough(entry.average, top.average) &&
      entry.rounds === top.rounds,
  );

export const computeWinner = ({
  mode,
  players,
  teams,
  results,
}: WinnerInput): WinnerSummary => {
  if (mode === "tdm") {
    const teamEntries: ScoreEntry[] = teams.map((team) => {
      const members = players.filter((player) => player.team_id === team.id);
      const teamResults = results.filter((result) =>
        members.some((member) => member.id === result.player_id),
      );
      const total = teamResults.reduce(
        (sum, result) => sum + result.overall_score,
        0,
      );
      const rounds = teamResults.length;
      const average = rounds > 0 ? total / rounds : 0;
      return { id: team.id, name: team.name, total, average, rounds };
    });

    if (teamEntries.length === 0) {
      return {
        kind: "none",
        winnerIds: [],
        label: i18n.t("minigameUi.noResultsYet"),
      };
    }

    const sorted = sortEntries(teamEntries);
    const top = sorted[0];
    const tied = getTiedEntries(sorted, top);
    if (tied.length > 1) {
      return {
        kind: "tie",
        winnerIds: tied.map((entry) => entry.id),
        label: formatNameList(
          tied.map((entry) => entry.name),
          "team",
        ),
        subLabel: i18n.t("minigameUi.winner.topScore", {
          score: top.total.toFixed(2),
        }),
      };
    }

    return {
      kind: "team",
      winnerIds: [top.id],
      label: i18n.t("minigameUi.winner.teamWins", { name: top.name }),
      subLabel: formatComparison(top.total, sorted[1]?.total),
    };
  }

  const playerEntries: ScoreEntry[] = players.map((player) => {
    const playerResults = results.filter(
      (result) => result.player_id === player.id,
    );
    const total = playerResults.reduce(
      (sum, result) => sum + result.overall_score,
      0,
    );
    const rounds = playerResults.length;
    const average = rounds > 0 ? total / rounds : 0;
    return { id: player.id, name: player.name, total, average, rounds };
  });

  if (playerEntries.length === 0) {
    return {
      kind: "none",
      winnerIds: [],
      label: i18n.t("minigameUi.noResultsYet"),
    };
  }

  const sorted = sortEntries(playerEntries);
  const top = sorted[0];
  const tied = getTiedEntries(sorted, top);
  if (tied.length > 1) {
    return {
      kind: "tie",
      winnerIds: tied.map((entry) => entry.id),
      label: formatNameList(
        tied.map((entry) => entry.name),
        "player",
      ),
      subLabel: i18n.t("minigameUi.winner.topScore", {
        score: top.total.toFixed(2),
      }),
    };
  }

  return {
    kind: "player",
    winnerIds: [top.id],
    label: i18n.t("minigameUi.winner.playerWins", { name: top.name }),
    subLabel: formatComparison(top.total, sorted[1]?.total),
  };
};
