import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type ModelSpec = {
  id: string;
  kind: string;
  display: {
    title: string;
    description: string;
    tags: string[];
    icon?: string | null;
  };
  compat: {
    platforms: string[];
    acceleration: string[];
    priority: number;
    requires_ram_gb: number;
    requires_vram_gb: number;
    disk_gb: number;
  };
  api: {
    endpoint: string;
    advertised_model_name: string;
    supports_stream: boolean;
  };
  backend: {
    provider: string;
    model_ref: string;
    device_hint: string;
  };
  limits: {
    timeout_sec: number;
    concurrency: number;
    max_input_mb: number;
    max_output_tokens_default: number;
  };
};

type ModelsPayload = {
  models: ModelSpec[];
};

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type ReleaseResponse = {
  assets: ReleaseAsset[];
};

type DownloadLink = {
  label: string;
  os: "windows" | "macos" | "linux";
  href: string | null;
};

const DEFAULT_DOWNLOADS: DownloadLink[] = [
  { label: "Windows", os: "windows", href: null },
  { label: "macOS", os: "macos", href: null },
  { label: "Linux", os: "linux", href: null }
];

const RELEASE_CACHE_KEY = "local-suite-release-assets";
const RELEASE_CACHE_TTL_MS = 1000 * 60 * 10;

export const LocalSuite = () => {
  const { t } = useTranslation();
  const [downloads, setDownloads] = useState<DownloadLink[]>(DEFAULT_DOWNLOADS);
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [query, setQuery] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    const repo = import.meta.env.VITE_GITHUB_REPO || "therapy-deliberate-practice/therapy-deliberate-practice";

    const applyAssets = (assets: ReleaseAsset[]) => {
      const mapped: DownloadLink[] = DEFAULT_DOWNLOADS.map((entry) => {
        const match = assets.find((asset) => asset.name.toLowerCase().includes(entry.os));
        return { ...entry, href: match?.browser_download_url ?? null };
      });
      setDownloads(mapped);
    };

    const cached = localStorage.getItem(RELEASE_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { timestamp: number; assets: ReleaseAsset[] };
        if (Date.now() - parsed.timestamp < RELEASE_CACHE_TTL_MS) {
          applyAssets(parsed.assets);
        }
      } catch {
        // ignore cache
      }
    }

    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load release");
        return response.json() as Promise<ReleaseResponse>;
      })
      .then((release) => {
        applyAssets(release.assets ?? []);
        localStorage.setItem(
          RELEASE_CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), assets: release.assets ?? [] })
        );
      })
      .catch(() => {
        setReleaseError(t("help.localSuite.downloads.error"));
      });
  }, [t]);

  useEffect(() => {
    fetch("/local-suite/models.json")
      .then((response) => response.json() as Promise<ModelsPayload>)
      .then((payload) => setModels(payload.models ?? []))
      .catch(() => setModels([]));
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return models;
    return models.filter((model) => {
      const haystack = [
        model.id,
        model.display.title,
        model.display.description,
        model.display.tags.join(" "),
        model.api.endpoint,
        model.backend.provider
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [models, query]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300">
          {t("help.localSuite.kicker")}
        </p>
        <h1 className="text-3xl font-semibold text-white">{t("help.localSuite.title")}</h1>
        <p className="text-sm text-slate-300">{t("help.localSuite.subtitle")}</p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">{t("help.localSuite.downloads.title")}</p>
            <p className="text-xs text-slate-400">{t("help.localSuite.downloads.subtitle")}</p>
          </div>
          {releaseError ? <span className="text-xs text-amber-300">{releaseError}</span> : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {downloads.map((download) => (
            <a
              key={download.os}
              href={download.href ?? "#"}
              className={`flex items-center justify-between rounded-2xl border border-white/10 px-4 py-3 text-sm font-semibold transition ${{
                true: "bg-white/10 text-white hover:bg-white/20",
                false: "bg-white/5 text-slate-400"
              }[Boolean(download.href)]}`}
              aria-disabled={!download.href}
            >
              <span>{download.label}</span>
              <span className="text-xs text-slate-400">
                {download.href ? t("help.localSuite.downloads.ready") : t("help.localSuite.downloads.pending")}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">{t("help.localSuite.catalog.title")}</p>
            <p className="text-xs text-slate-400">{t("help.localSuite.catalog.subtitle")}</p>
          </div>
          <div className="flex w-full items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 sm:w-80">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("help.localSuite.catalog.searchPlaceholder")}
              className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((model) => (
            <article key={model.id} className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{model.display.title}</h3>
                  <p className="text-xs text-slate-400">{model.display.description}</p>
                </div>
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-200 transition hover:bg-white/10"
                  onClick={() => navigator.clipboard.writeText(model.id)}
                >
                  {t("help.localSuite.catalog.copy")}
                </button>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {model.display.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-teal-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="mt-4 grid gap-3 text-xs text-slate-300 sm:grid-cols-2">
                <div>
                  <p className="font-semibold text-white">Endpoint</p>
                  <p>{model.api.endpoint}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Backend</p>
                  <p>{model.backend.provider}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Platform</p>
                  <p>{model.compat.platforms.join(", ")}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Acceleration</p>
                  <p>{model.compat.acceleration.join(", ")}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">Resources</p>
                  <p>
                    {model.compat.requires_ram_gb}GB RAM / {model.compat.requires_vram_gb}GB VRAM / {model.compat.disk_gb}GB
                    disk
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">Constraints</p>
                  <p>
                    {model.limits.max_input_mb}MB input · {model.limits.max_output_tokens_default} tokens
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-sm text-slate-400">
            {t("help.localSuite.catalog.empty")}
          </div>
        ) : null}
      </section>
    </div>
  );
};
