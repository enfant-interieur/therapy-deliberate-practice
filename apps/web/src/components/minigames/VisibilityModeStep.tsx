type VisibilityModeStepProps = {
  value: "normal" | "hard" | "extreme";
  onChange: (mode: "normal" | "hard" | "extreme") => void;
};

export const VisibilityModeStep = ({
  value,
  onChange,
}: VisibilityModeStepProps) => {
  const { t } = useTranslation();
  const modes = (["normal", "hard", "extreme"] as const).map((key) => ({
    key,
    title: t(`minigameUi.visibility.${key}.title`),
    description: t(`minigameUi.visibility.${key}.description`),
  }));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {modes.map((mode) => (
        <button
          key={mode.key}
          onClick={() => onChange(mode.key)}
          className={`rounded-2xl border p-4 text-left transition ${
            value === mode.key
              ? "border-teal-300/70 bg-teal-500/10 shadow-[0_0_20px_rgba(45,212,191,0.35)]"
              : "border-white/10 bg-white/5 hover:border-white/30"
          }`}
        >
          <p className="text-sm font-semibold text-white">{mode.title}</p>
          <p className="mt-2 text-xs text-slate-300">{mode.description}</p>
        </button>
      ))}
    </div>
  );
};
import { useTranslation } from "react-i18next";
