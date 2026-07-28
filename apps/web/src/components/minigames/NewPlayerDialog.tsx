import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

const avatarOptions = ["astro", "nova", "ember", "pulse", "lumen", "halo"];

type NewPlayerDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: { name: string; avatar: string }) => void;
};

export const NewPlayerDialog = ({
  open,
  onClose,
  onCreate,
}: NewPlayerDialogProps) => {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(avatarOptions[0]);

  const canSubmit = useMemo(() => name.trim().length > 0, [name]);
  const { dialogRef, titleId } = useAccessibleDialog(open, onClose);

  useEffect(() => {
    if (!open) return;
    setName("");
    setAvatar(avatarOptions[0]);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl backdrop-blur"
      >
        <h3 id={titleId} className="text-lg font-semibold text-white">
          {t("minigameUi.newPlayer")}
        </h3>
        <p className="mt-1 text-xs text-slate-300">
          {t("minigameUi.newPlayerDescription")}
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="new-player-name"
              className="text-xs uppercase tracking-[0.2em] text-slate-400"
            >
              {t("minigameUi.name")}
            </label>
            <input
              id="new-player-name"
              data-dialog-autofocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("minigameUi.playerName")}
              className="mt-2 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-slate-400">
              {t("minigameUi.avatar")}
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {avatarOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setAvatar(option)}
                  className={`rounded-full border px-3 py-1 text-xs uppercase tracking-wide ${
                    avatar === option
                      ? "border-teal-300/70 bg-teal-500/20 text-teal-100"
                      : "border-white/10 bg-white/5 text-white/70"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/40"
          >
            {t("minigameUi.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onCreate({ name: name.trim(), avatar })}
            disabled={!canSubmit}
            className="rounded-full border border-teal-300/60 bg-teal-500/30 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 disabled:cursor-not-allowed disabled:opacity-60 hover:border-teal-200"
          >
            {t("minigameUi.create")}
          </button>
        </div>
      </div>
    </div>
  );
};
