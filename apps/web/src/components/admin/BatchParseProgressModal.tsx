import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card } from "./AdminUi";
import { useAppDispatch } from "../../store/hooks";
import { api, useGetBatchParseStatusQuery } from "../../store/api";

const stepLabels: Record<string, string> = {
  created_job: "Queued",
  planning_segments: "Planning",
  parsing_segment: "Parsing",
  persisting_task: "Saving drafts",
  done: "Done"
};

const statusToneClass = (status: "queued" | "running" | "completed" | "failed" | "canceled") => {
  if (status === "failed") return "border-rose-400/60 text-rose-200";
  if (status === "completed") return "border-emerald-400/60 text-emerald-200";
  return "border-white/20 text-white/80";
};

const formatTime = (ts: number) => new Date(ts).toLocaleTimeString();

type Props = {
  jobId: string;
  onClose: () => void;
};

export const BatchParseProgressModal = ({ jobId, onClose }: Props) => {
  const dispatch = useAppDispatch();
  const [afterEventId, setAfterEventId] = useState(0);
  const [events, setEvents] = useState<
    Array<{ id: number; ts: number; level: "info" | "warn" | "error"; step: string; message: string; meta: unknown | null }>
  >([]);
  const [pollingMs, setPollingMs] = useState(800);

  useEffect(() => {
    setAfterEventId(0);
    setEvents([]);
    setPollingMs(800);
  }, [jobId]);

  const query = useGetBatchParseStatusQuery(
    { jobId, afterEventId },
    { skip: !jobId, pollingInterval: pollingMs, refetchOnMountOrArgChange: true }
  );
  const job = query.data?.job;

  useEffect(() => {
    if (!query.data) return;
    if (query.data.events.length) {
      setEvents((prev) => {
        const seen = new Set(prev.map((event) => event.id));
        const merged = [...prev, ...query.data!.events.filter((event) => !seen.has(event.id))];
        merged.sort((a, b) => a.id - b.id);
        return merged;
      });
      setAfterEventId(query.data.nextAfterEventId);
    }
  }, [query.data]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" || job.status === "failed" || job.status === "canceled") {
      setPollingMs(0);
      dispatch(api.util.invalidateTags(["Task"]));
    }
  }, [job, dispatch]);

  const total = job?.totalSegments ?? null;
  const completed = job?.completedSegments ?? 0;
  const progress = total && total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : job?.status === "completed" ? 100 : 0;

  const headerLabel = useMemo(() => {
    if (!job) {
      return { text: "Loading…", className: "border-white/20 text-white/80" };
    }
    if (job.status === "failed") {
      return { text: "Failed", className: statusToneClass("failed") };
    }
    if (job.status === "completed") {
      return { text: "Completed", className: statusToneClass("completed") };
    }
    return { text: stepLabels[job.step] ?? "Running", className: statusToneClass(job.status) };
  }, [job]);

  const steps = ["created_job", "planning_segments", "parsing_segment", "persisting_task", "done"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-3xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-white">Batch parsing</h2>
              <Badge className={headerLabel.className}>{headerLabel.text}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-300/80">
              {total ? `${completed} of ${total} segments processed` : "Detecting segments…"}
            </p>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-teal-400/80 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
            <span>{job ? stepLabels[job.step] ?? job.step : "…"}</span>
            {total ? <span>{progress}%</span> : null}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-5">
          {steps.map((step) => {
            const active = job?.step === step;
            const done =
              job?.status === "completed"
                ? true
                : job
                  ? steps.indexOf(job.step) > steps.indexOf(step)
                  : false;
            const baseClasses =
              "rounded-xl border px-3 py-2 text-sm font-semibold transition-colors";
            const className = active
              ? `${baseClasses} border-teal-400/60 bg-teal-400/10 text-white`
              : done
                ? `${baseClasses} border-white/15 text-white/80`
                : `${baseClasses} border-white/10 text-slate-400`;
            return (
              <div key={step} className={className}>
                {stepLabels[step] ?? step}
              </div>
            );
          })}
        </div>

        <div className="mt-4 max-h-[45vh] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/40">
          {events.length === 0 ? (
            <div className="p-4 text-sm text-slate-300/80">Waiting for updates…</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {events.map((event) => (
                <li key={event.id} className="p-4">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          event.level === "error"
                            ? "border-rose-400/60 text-rose-200"
                            : "border-white/20 text-white/80"
                        }
                      >
                        {event.level}
                      </Badge>
                      <span>{stepLabels[event.step] ?? event.step}</span>
                    </div>
                    <span>{formatTime(event.ts)}</span>
                  </div>
                  <p className="mt-1 text-sm text-white">{event.message}</p>
                  {event.meta && (
                    <pre className="mt-2 overflow-x-auto rounded-xl bg-black/30 p-2 text-xs text-slate-300">
                      {JSON.stringify(event.meta, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {job?.status === "completed" && job.createdTaskIds.length > 0 && (
          <div className="mt-4 rounded-2xl border border-white/10 p-4">
            <p className="text-sm font-semibold text-white">Drafts created</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {job.createdTaskIds.map((taskId) => (
                <Button
                  key={taskId}
                  variant="ghost"
                  className="border border-white/10 text-xs font-normal text-white/90"
                  onClick={() => window.open(`/admin/tasks/${taskId}`, "_blank")}
                >
                  Open {taskId}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Task library has been refreshed with these drafts.</p>
          </div>
        )}

        {job?.status === "failed" && (
          <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {job.error ?? "Unknown error occurred."}
          </div>
        )}
      </Card>
    </div>
  );
};
