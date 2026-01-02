import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";

const downloads = [
  {
    label: "macOS",
    description: "Universal macOS launcher (Apple Silicon + Intel).",
    href: "https://github.com/therapy-deliberate-practice/therapy-deliberate-practice/releases/latest"
  },
  {
    label: "Windows",
    description: "Windows x64 installer for local runtime suite.",
    href: "https://github.com/therapy-deliberate-practice/therapy-deliberate-practice/releases/latest"
  },
  {
    label: "Linux",
    description: "Linux x64 package for local runtime suite.",
    href: "https://github.com/therapy-deliberate-practice/therapy-deliberate-practice/releases/latest"
  }
];

const models = [
  {
    id: "local/llm/qwen3-mlx",
    endpoint: "/v1/responses",
    description: "Qwen3 running with MLX acceleration for macOS."
  },
  {
    id: "local/llm/qwen3-hf",
    endpoint: "/v1/responses",
    description: "Qwen3 via Hugging Face transformers in a subprocess."
  },
  {
    id: "local/tts/kokoro",
    endpoint: "/v1/audio/speech",
    description: "Local Kokoro TTS with streaming audio."
  },
  {
    id: "local/stt/faster-whisper",
    endpoint: "/v1/audio/transcriptions",
    description: "Faster Whisper speech-to-text with transcript streaming."
  }
];

export const LocalSuite = () => {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="Local suite"
        title="Run the Local Runtime Suite"
        subtitle="Install the desktop launcher to run LLM, TTS, and STT workloads locally with OpenAI-compatible endpoints."
      />

      <Section title="Download the launcher" subtitle="Pick the build for your OS.">
        <div className="grid gap-4 md:grid-cols-3">
          {downloads.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 text-left transition hover:border-teal-400/60"
              rel="noreferrer"
              target="_blank"
            >
              <p className="text-sm font-semibold text-white">{item.label}</p>
              <p className="mt-2 text-xs text-slate-400">{item.description}</p>
              <p className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-teal-200">
                View latest release
                <span aria-hidden>→</span>
              </p>
            </a>
          ))}
        </div>
      </Section>

      <Section title="Available local models" subtitle="Each model maps to an OpenAI-compatible endpoint.">
        <div className="space-y-3">
          {models.map((model) => (
            <div
              key={model.id}
              className="flex flex-col gap-2 rounded-3xl border border-white/10 bg-slate-950/60 p-4 md:flex-row md:items-center md:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-white">{model.id}</p>
                <p className="text-xs text-slate-400">{model.description}</p>
              </div>
              <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-teal-200">
                {model.endpoint}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Connect from the app" subtitle="Use the base URL shown in the launcher.">
        <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-200">
          <p>
            Set your OpenAI base URL to the value shown in the launcher (for example,
            <span className="font-semibold text-white"> http://127.0.0.1:8000</span>) and keep the launcher running while
            you practice.
          </p>
        </div>
      </Section>
    </div>
  );
};
