import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "./help/components/PageHeader";
import {
  useDeleteMinigameSessionMutation,
  useListMinigameSessionsQuery,
  type MinigameSessionSummary,
} from "../store/api";
import { SessionFilters } from "../components/minigames/history/SessionFilters";
import { SessionCard } from "../components/minigames/history/SessionCard";
import { SessionListSkeleton } from "../components/minigames/history/SessionListSkeleton";
import { EmptyState } from "../components/minigames/history/EmptyState";
import { DeleteSessionConfirmDialog } from "../components/minigames/history/DeleteSessionConfirmDialog";
import { useTranslation } from "react-i18next";

export const MinigameHubPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [status, setStatus] = useState<"active" | "ended" | "all">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "recently_active">(
    "newest",
  );
  const [pendingDelete, setPendingDelete] =
    useState<MinigameSessionSummary | null>(null);

  const { data, isLoading, isError, refetch } = useListMinigameSessionsQuery({
    status,
    sort,
  });
  const [deleteSession, deleteState] = useDeleteMinigameSessionMutation();

  const sessions = useMemo(() => data?.sessions ?? [], [data?.sessions]);

  const handleOpenSession = (session: MinigameSessionSummary) => {
    if (session.ended_at) {
      navigate(`/minigames/session/${session.id}`);
    } else {
      navigate(`/minigames/play/${session.id}`);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    try {
      await deleteSession({ sessionId: pendingDelete.id }).unwrap();
      setPendingDelete(null);
    } catch {
      // The mutation state renders the recoverable error and the dialog remains open.
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        kicker={t("minigameHub.kicker")}
        title={t("minigameHub.title")}
        subtitle={t("minigameHub.subtitle")}
        actions={
          <button
            onClick={() =>
              navigate("/minigames/play", { state: { fromHub: true } })
            }
            className="rounded-full border border-teal-300/40 bg-teal-500/20 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-teal-100"
          >
            {t("minigameHub.newGame")}
          </button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <SessionFilters
          status={status}
          sort={sort}
          onStatusChange={setStatus}
          onSortChange={setSort}
        />
      </div>

      {isError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4 text-sm text-rose-100"
        >
          <p>{t("minigameHub.loadError")}</p>
          <button
            onClick={() => refetch()}
            className="rounded-full border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100"
          >
            {t("minigameHub.retry")}
          </button>
        </div>
      )}

      {isLoading ? (
        <SessionListSkeleton />
      ) : sessions.length ? (
        <div className="space-y-4">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onOpen={() => handleOpenSession(session)}
              onDelete={() => setPendingDelete(session)}
            />
          ))}
        </div>
      ) : !isError ? (
        <EmptyState
          title={t("minigameHub.emptyTitle")}
          description={t("minigameHub.emptyDescription")}
          actionLabel={t("minigameHub.startGame")}
          onAction={() =>
            navigate("/minigames/play", { state: { fromHub: true } })
          }
        />
      ) : null}

      <DeleteSessionConfirmDialog
        open={Boolean(pendingDelete)}
        sessionLabel={
          pendingDelete
            ? t("minigameUi.sessionModeLabel", {
                mode: t(
                  pendingDelete.game_type === "tdm"
                    ? "minigameUi.teamDeathmatch"
                    : "minigameUi.freeForAll",
                ),
              })
            : undefined
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDeleteConfirm}
      />

      {deleteState.isError && (
        <div
          role="alert"
          className="rounded-2xl border border-rose-300/40 bg-rose-500/10 p-4 text-sm text-rose-100"
        >
          {t("minigameHub.deleteError")}
        </div>
      )}
    </div>
  );
};
