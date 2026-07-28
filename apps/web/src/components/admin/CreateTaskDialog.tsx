import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";
import { Button, Input, Label, Select, Textarea } from "./AdminUi";
import { TagInput } from "./TagInput";

export type CreateTaskPayload = {
  title: string;
  skill_domain: string;
  description: string;
  base_difficulty: number;
  general_objective?: string | null;
  tags: string[];
  authors: string[];
  language: string;
  is_published: boolean;
  criteria?: Array<{ id: string; label: string; description: string }>;
  examples?: Array<{
    id: string;
    difficulty: number;
    severity_label?: string | null;
    patient_text: string;
  }>;
  interaction_examples?: Array<{
    id: string;
    difficulty: number;
    title?: string | null;
    patient_text: string;
    therapist_text: string;
  }>;
};

type CreateTaskDialogProps = {
  open: boolean;
  canDuplicate: boolean;
  onClose: () => void;
  onCreate: (payload: CreateTaskPayload) => void;
  onDuplicate: () => void;
};

const emptyPayload = (): CreateTaskPayload => ({
  title: "",
  skill_domain: "",
  description: "",
  base_difficulty: 3,
  general_objective: "",
  tags: [],
  authors: [],
  language: "en",
  is_published: false,
});

export const CreateTaskDialog = ({
  open,
  canDuplicate,
  onClose,
  onCreate,
  onDuplicate,
}: CreateTaskDialogProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"blank" | "json">("blank");
  const [payload, setPayload] = useState<CreateTaskPayload>(emptyPayload());
  const [jsonValue, setJsonValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPayload(emptyPayload());
    setJsonValue("");
    setError(null);
    setMode("blank");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);
  const { dialogRef, titleId } = useAccessibleDialog(open, handleClose);

  if (!open) return null;

  const handleCreate = () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonValue);
        const draft: CreateTaskPayload = {
          ...payload,
          ...parsed,
          tags: Array.isArray(parsed.tags) ? parsed.tags : payload.tags,
          authors: Array.isArray(parsed.authors)
            ? parsed.authors
            : payload.authors,
        };
        if (!draft.title || !draft.skill_domain || !draft.description) {
          setError(t("admin.create.errors.missingFields"));
          return;
        }
        onCreate(draft);
        handleClose();
      } catch (err) {
        setError((err as Error).message);
      }
      return;
    }

    if (!payload.title || !payload.skill_domain || !payload.description) {
      setError(t("admin.create.errors.missingFields"));
      return;
    }
    onCreate(payload);
    handleClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 id={titleId} className="text-lg font-semibold text-white">
              {t("admin.create.title")}
            </h3>
            <p className="text-sm text-slate-400">
              {t("admin.create.subtitle")}
            </p>
          </div>
          <Button variant="ghost" onClick={handleClose}>
            {t("admin.actions.close")}
          </Button>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            variant={mode === "blank" ? "primary" : "secondary"}
            onClick={() => setMode("blank")}
          >
            {t("admin.create.templates.blank")}
          </Button>
          <Button
            type="button"
            variant={mode === "json" ? "primary" : "secondary"}
            onClick={() => setMode("json")}
          >
            {t("admin.create.templates.json")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onDuplicate();
              handleClose();
            }}
            disabled={!canDuplicate}
          >
            {t("admin.create.templates.duplicate")}
          </Button>
        </div>

        <div className="mt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="create-task-title">
                {t("admin.task.titleLabel")}
              </Label>
              <Input
                id="create-task-title"
                data-dialog-autofocus
                value={payload.title}
                onChange={(event) =>
                  setPayload({ ...payload, title: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-skill-domain">
                {t("admin.task.skillDomainLabel")}
              </Label>
              <Input
                id="create-task-skill-domain"
                value={payload.skill_domain}
                onChange={(event) =>
                  setPayload({ ...payload, skill_domain: event.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-difficulty">
                {t("admin.task.difficultyLabel")}
              </Label>
              <Select
                id="create-task-difficulty"
                value={payload.base_difficulty}
                onChange={(event) =>
                  setPayload({
                    ...payload,
                    base_difficulty: Number(event.target.value),
                  })
                }
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={`difficulty-${value}`} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-tags">
                {t("admin.task.tagsLabel")}
              </Label>
              <Input
                id="create-task-tags"
                value={payload.tags.join(", ")}
                onChange={(event) =>
                  setPayload({
                    ...payload,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className="md:col-span-2">
              <TagInput
                label={t("admin.task.authorsLabel")}
                placeholder={t("admin.task.authorsPlaceholder")}
                value={payload.authors}
                onChange={(authors) => setPayload({ ...payload, authors })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-task-language">
                {t("appShell.language.label")}
              </Label>
              <Select
                id="create-task-language"
                value={payload.language}
                onChange={(event) =>
                  setPayload({ ...payload, language: event.target.value })
                }
              >
                <option value="en">{t("appShell.language.english")}</option>
                <option value="fr">{t("appShell.language.french")}</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-task-description">
              {t("admin.task.descriptionLabel")}
            </Label>
            <Textarea
              id="create-task-description"
              value={payload.description}
              onChange={(event) =>
                setPayload({ ...payload, description: event.target.value })
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="create-task-objective">
              {t("admin.task.generalObjectiveLabel")}
            </Label>
            <Textarea
              id="create-task-objective"
              value={payload.general_objective ?? ""}
              onChange={(event) =>
                setPayload({
                  ...payload,
                  general_objective: event.target.value,
                })
              }
            />
          </div>
          {mode === "json" && (
            <div className="space-y-2">
              <Label htmlFor="create-task-json">
                {t("admin.create.jsonLabel")}
              </Label>
              <Textarea
                id="create-task-json"
                className="min-h-[160px] font-mono text-xs"
                value={jsonValue}
                onChange={(event) => setJsonValue(event.target.value)}
                placeholder={t("admin.create.jsonPlaceholder")}
              />
            </div>
          )}
          {error && <p className="text-xs text-rose-300">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={handleClose}>
            {t("admin.actions.cancel")}
          </Button>
          <Button variant="primary" onClick={handleCreate}>
            {t("admin.actions.create")}
          </Button>
        </div>
      </div>
    </div>
  );
};
