type GameSelectModalProps = {
  open: boolean;
  onClose: () => void;
  onSelect: (mode: "ffa" | "tdm") => void;
};

const modes = [
  {
    key: "tdm" as const,
    title: "Team Deathmatch",
    description: "Squad-based duels with a smart tournament schedule.",
    accent: "from-teal-400/40 via-slate-900/60 to-indigo-500/40"
  },
  {
    key: "ffa" as const,
    title: "Free For All",
    description: "Jump in with any player, anytime. End when you're ready.",
    accent: "from-fuchsia-400/40 via-slate-900/60 to-amber-500/40"
  }
];

export const GameSelectModal = ({ open, onClose, onSelect }: GameSelectModalProps) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-6"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="mx-auto w-full max-w-4xl max-h-[90dvh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/80 p-8 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-200/70">Minigames</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Choose your mode</h2>
            <p className="mt-2 text-sm text-slate-300">
              Launch a premium round-based experience powered by the practice pipeline.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70 hover:border-white/30 hover:text-white"
          >
            Close
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
                  <h3 className="text-xl font-semibold text-white">{mode.title}</h3>
                  <p className="mt-2 text-sm text-slate-200/80">{mode.description}</p>
                </div>
                <button
                  onClick={() => onSelect(mode.key)}
                  className="mt-auto inline-flex items-center justify-center rounded-full border border-teal-300/50 bg-teal-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-100 transition hover:-translate-y-0.5 hover:border-teal-200 hover:bg-teal-400/30"
                >
                  Start setup
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
