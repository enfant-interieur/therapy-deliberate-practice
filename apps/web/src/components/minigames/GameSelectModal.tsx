import { useTranslation } from "react-i18next";
import { useAccessibleDialog } from "../../hooks/useAccessibleDialog";

type GameSelectModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: "ffa" | "tdm") => void;
};

export const GameSelectModal = ({
  open,
  onClose,
  onSelect,
}: GameSelectModalProps) => {
  const { t } = useTranslation();
  const { dialogRef, titleId } = useAccessibleDialog(open, onClose);
  const modes = [
    {
      key: "tdm" as const,
      title: t("minigameUi.teamDeathmatch"),
      description: t("minigameUi.teamDeathmatchDescription"),
      accent: "from-teal-400/40 via-slate-900/60 to-indigo-500/40",
    },
    {
      key: "ffa" as const,
      title: t("minigameUi.freeForAll"),
      description: t("minigameUi.freeForAllDescription"),
      accent: "from-fuchsia-400/40 via-slate-900/60 to-amber-500/40",
    },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex min-h-[100dvh] items-end justify-center md:items-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="mx-auto w-full max-w-4xl max-h-[90dvh] overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-950/80 p-8 shadow-2xl backdrop-blur md:rounded-3xl"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">
                {t("appShell.nav.minigames")}
              </p>
              <h2
                id={titleId}
                className="mt-2 text-3xl font-semibold text-white"
              >
                {t("minigameUi.chooseMode")}
              </h2>
              <p className="mt-2 text-sm text-slate-300">
                {t("minigameUi.chooseModeDescription")}
              </p>
            </div>
            <button
              data-dialog-autofocus
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
            >
              {t("minigameUi.close")}
            </button>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {modes.map((mode) => (
              <div
                key={mode.key}
                className={`group relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br ${mode.accent} p-6 shadow-[0_0_40px_rgba(15,23,42,0.4)]`}
              >
                <div className="absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_60%)]" />
                </div>
                <div className="relative z-10 flex h-full flex-col gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-white">
                      {mode.title}
                    </h3>
                    <p className="mt-2 text-sm text-slate-200/80">
                      {mode.description}
                    </p>
                  </div>
                  <button
                    onClick={() => onSelect(mode.key)}
                    className="mt-auto inline-flex items-center justify-center rounded-full border border-teal-300/50 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-400/30"
                  >
                    {t("minigameUi.startSetup")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
