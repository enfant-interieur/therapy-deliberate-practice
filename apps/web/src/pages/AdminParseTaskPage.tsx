import { useMemo, useState } from "react";
import type { DeliberatePracticeTaskV2, ParseMode } from "@deliberate/shared";
import { deliberatePracticeTaskV2Schema } from "@deliberate/shared";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Input, Label, SectionHeader, Select, Textarea } from "../components/admin/AdminUi";
import { ToastProvider, useToast } from "../components/admin/ToastProvider";
import { useImportTaskMutation, useParseTaskMutation } from "../store/api";

const SummaryRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    <p className="text-sm text-white">{value}</p>
  </div>
);

const AdminParseTaskPageContent = () => {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [freeText, setFreeText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [parseMode, setParseMode] = useState<ParseMode>("original");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeliberatePracticeTaskV2 | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [jsonVisible, setJsonVisible] = useState(false);
  const isPartialPrompt = parseMode === "partial_prompt";
  const freeTextLabel = isPartialPrompt
    ? "Instruction prompt"
    : t("admin.parse.inputs.freeText");

  const [parseTask, parseState] = useParseTaskMutation();
  const [importTask, importState] = useImportTaskMutation();

  const jsonPreview = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result]);
  const validation = useMemo(
    () => (result ? deliberatePracticeTaskV2Schema.safeParse(result) : null),
    [result]
  );
  const validationMessage = validation?.success
    ? t("admin.parse.validationValid")
    : validation
      ? validation.error.issues[0]?.message ?? t("admin.parse.validationInvalid")
      : t("admin.parse.validationEmpty");
  const canCreate = Boolean(result && reviewed && validation?.success && !importState.isLoading);

  const handleParse = async () => {
    setError(null);
    try {
      const parsed = await parseTask({
        free_text: freeText || undefined,
        source_url: sourceUrl || undefined,
        parse_mode: parseMode
      }).unwrap();
      setResult(parsed);
      setReviewed(false);
      setJsonVisible(true);
    } catch (err) {
      setError((err as Error).message);
      pushToast({
        title: t("admin.toast.error"),
        message: (err as Error).message,
        tone: "error"
      });
    }
  };

  const handleImport = async () => {
    if (!result || !validation?.success || !reviewed) return;
    try {
      const response = await importTask({ task_v2: result }).unwrap();
      pushToast({ title: t("admin.parse.createdToast"), tone: "success" });
      navigate(`/admin/tasks/${response.id}`);
    } catch (err) {
      pushToast({
        title: t("admin.toast.error"),
        message: (err as Error).message,
        tone: "error"
      });
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SectionHeader
            kicker={t("admin.parse.kicker")}
            title={t("admin.parse.pageTitle")}
            subtitle={t("admin.parse.pageSubtitle")}
          />
          <Button variant="secondary" onClick={() => navigate("/admin")}>
            {t("admin.actions.backToPortal")}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <Card className="space-y-6 p-6">
            <div className="space-y-2">
              <Label>{freeTextLabel}</Label>
              <Textarea
                className="min-h-[240px]"
                value={freeText}
                onChange={(event) => setFreeText(event.target.value)}
                placeholder={t("admin.createFromText.placeholderText")}
              />
              {isPartialPrompt && (
                <p className="text-xs text-slate-400">
                  Provide instructions for the task you want generated (not source material to parse).
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("admin.parse.inputs.sourceUrl")}</Label>
              <Input
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("admin.parse.inputs.parseMode")}</Label>
              <Select
                value={parseMode}
                onChange={(event) => setParseMode(event.target.value as ParseMode)}
              >
                <option value="original">{t("admin.parse.mode.original")}</option>
                <option value="exact">{t("admin.parse.mode.exact")}</option>
                <option value="partial_prompt">From partial prompt</option>
              </Select>
            </div>
            {error && <p className="text-xs text-rose-300">{error}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={handleParse} disabled={parseState.isLoading}>
                {parseState.isLoading ? t("admin.createFromText.parsing") : t("admin.createFromText.parse")}
              </Button>
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  setFreeText("");
                  setSourceUrl("");
                  setParseMode("original");
                  setResult(null);
                  setReviewed(false);
                  setError(null);
                }}
              >
                {t("admin.actions.reset")}
              </Button>
            </div>
          </Card>

          <Card className="space-y-4 p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/70">
                {t("admin.parse.reviewKicker")}
              </p>
              <h3 className="text-lg font-semibold text-white">{t("admin.parse.reviewTitle")}</h3>
              <p className="text-sm text-slate-400">{t("admin.parse.reviewSubtitle")}</p>
            </div>
            {!result && (
              <p className="text-sm text-slate-400">{t("admin.parse.reviewEmpty")}</p>
            )}
            {result && (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <SummaryRow label={t("admin.task.titleLabel")} value={result.task.title} />
                  <SummaryRow label={t("admin.task.skillDomainLabel")} value={result.task.skill_domain} />
                  <SummaryRow
                    label={t("admin.task.difficultyLabel")}
                    value={String(result.task.base_difficulty)}
                  />
                  <SummaryRow label={t("admin.parse.summary.criteria")} value={String(result.criteria.length)} />
                  <SummaryRow label={t("admin.parse.summary.examples")} value={String(result.examples.length)} />
                  <SummaryRow label={t("admin.parse.summary.tags")} value={String(result.task.tags?.length ?? 0)} />
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Badge className={validation?.success ? "border-teal-400/40 text-teal-100" : "border-rose-400/40 text-rose-200"}>
                    {validation?.success ? t("admin.parse.validationPass") : t("admin.parse.validationFail")}
                  </Badge>
                  <span>{validationMessage}</span>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                  />
                  {t("admin.parse.reviewConfirm")}
                </label>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setJsonVisible((prev) => !prev)}
                >
                  {jsonVisible ? t("admin.parse.hideJson") : t("admin.parse.showJson")}
                </Button>
                {jsonVisible && (
                  <Textarea className="min-h-[220px] font-mono text-xs" value={jsonPreview} readOnly />
                )}
                <Button variant="primary" onClick={handleImport} disabled={!canCreate}>
                  {importState.isLoading ? t("admin.task.importing") : t("admin.parse.createAction")}
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export const AdminParseTaskPage = () => (
  <ToastProvider>
    <AdminParseTaskPageContent />
  </ToastProvider>
);
