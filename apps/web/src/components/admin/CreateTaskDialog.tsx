import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Label, Select, Textarea } from "./AdminUi";

export type CreateTaskPayload = {
  title: string;
  skill_domain: string;
  description: string;
  base_difficulty: number;
  general_objective?: string | null;
  tags: string[];
  language: string;
  is_published: boolean;
  criteria?: Array<{ id: string; label: string; description: string }>;
  examples?: Array<{
    id: string;
    difficulty: number;
    severity_label?: string | null;
    patient_text: string;
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
  language: "en",
  is_published: false
});

export const CreateTaskDialog = ({
  open,
  canDuplicate,
  onClose,
  onCreate,
  onDuplicate
}: CreateTaskDialogProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"blank" | "json">("blank");
  const [payload, setPayload] = useState<CreateTaskPayload>(emptyPayload());
  const [jsonValue, setJsonValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!open) return null;

  const reset = () => {
    setPayload(emptyPayload());
    setJsonValue("");
    setError(null);
    setMode("blank");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const firstInput = containerRef.current?.querySelector<HTMLElement>(
      "input, textarea, select, button"
    );
    firstInput?.focus();
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          containerRef.current?.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])'
          ) ?? []
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
          event.preventDefault();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
          event.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [open]);

  const handleCreate = () => {
    if (mode === "json") {
      try {
        const parsed = JSON.parse(jsonValue);
        const draft: CreateTaskPayload = {
          ...payload,
          ...parsed,
          tags: Array.isArray(parsed.tags) ? parsed.tags : payload.tags
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950/90 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white">{t("admin.create.title")}</h3>
            <p className="text-sm text-slate-400">{t("admin.create.subtitle")}</p>
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
              <Label>{t("admin.task.titleLabel")}</Label>
              <Input
                value={payload.title}
                onChange={(event) => setPayload({ ...payload, title: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.skillDomainLabel")}</Label>
              <Input
                value={payload.skill_domain}
                onChange={(event) => setPayload({ ...payload, skill_domain: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.task.difficultyLabel")}</Label>
              <Select
                value={payload.base_difficulty}
                onChange={(event) =>
                  setPayload({ ...payload, base_difficulty: Number(event.target.value) })
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
              <Label>{t("admin.task.tagsLabel")}</Label>
              <Input
                value={payload.tags.join(", ")}
                onChange={(event) =>
                  setPayload({
                    ...payload,
                    tags: event.target.value
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>{t("appShell.language.label")}</Label>
              <Select
                value={payload.language}
                onChange={(event) => setPayload({ ...payload, language: event.target.value })}
              >
                <option value="en">{t("appShell.language.english")}</option>
                <option value="fr">{t("appShell.language.french")}</option>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("admin.task.descriptionLabel")}</Label>
            <Textarea
              value={payload.description}
              onChange={(event) => setPayload({ ...payload, description: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("admin.task.generalObjectiveLabel")}</Label>
            <Textarea
              value={payload.general_objective ?? ""}
              onChange={(event) =>
                setPayload({ ...payload, general_objective: event.target.value })
              }
            />
          </div>
          {mode === "json" && (
            <div className="space-y-2">
              <Label>{t("admin.create.jsonLabel")}</Label>
              <Textarea
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
