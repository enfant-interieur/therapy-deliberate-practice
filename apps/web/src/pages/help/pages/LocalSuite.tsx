import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  findDownloadAsset,
  type DownloadPlatform,
  type ReleaseAsset,
} from "./localSuiteDownloads";

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

type ReleaseResponse = {
  assets: ReleaseAsset[];
};

type DownloadLink = {
  label: string;
  platform: DownloadPlatform;
  href: string | null;
  statusLabel?: string;
};

const RELEASE_CACHE_KEY = "local-suite-release-assets";
const RELEASE_CACHE_TTL_MS = 1000 * 60 * 10;
const DEFAULT_GITHUB_REPO = "enfant-interieur/therapy-deliberate-practice";
const DEFAULT_LOCAL_DOCS_URL = "http://127.0.0.1:8484/docs";

const PLATFORM_LABELS: Record<string, string> = {
  "darwin-arm64": "macOS (Apple silicon)",
  "darwin-x64": "macOS (Intel)",
  "windows-x64": "Windows (x64)",
  "linux-x64": "Linux (x64)",
};

const ACCELERATION_LABELS: Record<string, string> = {
  cpu: "CPU",
  cuda: "NVIDIA CUDA",
  metal: "Apple Metal",
};

export const LocalSuite = () => {
  const { t } = useTranslation();
  const baseDownloads = useMemo<DownloadLink[]>(
    () => [
      {
        label: t("help.localSuite.downloads.labels.windows"),
        platform: "windows-x64",
        href: null,
      },
      {
        label: t("help.localSuite.downloads.labels.macosAppleSilicon"),
        platform: "darwin-arm64",
        href: null,
      },
      {
        label: t("help.localSuite.downloads.labels.macosIntel"),
        platform: "darwin-x64",
        href: null,
      },
      {
        label: t("help.localSuite.downloads.labels.linux"),
        platform: "linux-x64",
        href: null,
      },
    ],
    [t],
  );
  const [downloads, setDownloads] = useState<DownloadLink[]>(baseDownloads);
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [query, setQuery] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    const repo = import.meta.env.VITE_GITHUB_REPO || DEFAULT_GITHUB_REPO;
    let cancelled = false;
    setDownloads(baseDownloads);
    setReleaseError(null);

    const applyAssets = (assets: ReleaseAsset[]) => {
      if (cancelled) return;
      const mapped: DownloadLink[] = baseDownloads.map((entry) => {
        const match = findDownloadAsset(assets, entry.platform);
        return { ...entry, href: match?.browser_download_url ?? null };
      });
      setDownloads(mapped);
    };

    let cachedAssets: ReleaseAsset[] | null = null;
    const cached = localStorage.getItem(RELEASE_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          timestamp: number;
          assets: ReleaseAsset[];
        };
        if (Number.isFinite(parsed.timestamp) && Array.isArray(parsed.assets)) {
          cachedAssets = parsed.assets;
        }
        if (
          cachedAssets &&
          Date.now() - parsed.timestamp < RELEASE_CACHE_TTL_MS
        ) {
          applyAssets(parsed.assets);
        }
      } catch {
        // ignore cache
      }
    }

    fetch(`https://api.github.com/repos/${repo}/releases/latest`)
      .then((response) => {
        if (response.status === 404) {
          localStorage.removeItem(RELEASE_CACHE_KEY);
          if (!cancelled) {
            setReleaseError(t("help.localSuite.downloads.empty"));
          }
          return { assets: [] } satisfies ReleaseResponse;
        }
        if (!response.ok)
          throw new Error(
            t("help.localSuite.downloads.requestFailed", {
              status: response.status,
            }),
          );
        return response.json() as Promise<ReleaseResponse>;
      })
      .then((release) => {
        if (cancelled) return;
        applyAssets(release.assets ?? []);
        if (release.assets?.length) {
          localStorage.setItem(
            RELEASE_CACHE_KEY,
            JSON.stringify({ timestamp: Date.now(), assets: release.assets }),
          );
        }
      })
      .catch(() => {
        if (cancelled) return;
        if (cachedAssets?.length) {
          applyAssets(cachedAssets);
          setReleaseError(t("help.localSuite.downloads.staleCache"));
          return;
        }
        setReleaseError(t("help.localSuite.downloads.error"));
      });
    return () => {
      cancelled = true;
    };
  }, [baseDownloads, t]);

  useEffect(() => {
    let cancelled = false;
    fetch("/local-suite/models.json")
      .then((response) => response.json() as Promise<ModelsPayload>)
      .then((payload) => {
        if (!cancelled) setModels(payload.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
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
        model.backend.provider,
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
        <h1 className="text-3xl font-semibold text-white">
          {t("help.localSuite.title")}
        </h1>
        <p className="text-sm text-slate-300">
          {t("help.localSuite.subtitle")}
        </p>
      </header>

      <section className="rounded-3xl border border-white/10 bg-slate-950/60 p-6">
        <div className="space-y-2">
          <p className="text-sm font-semibold text-white">
            {t("help.localSuite.overview.title")}
          </p>
          <p className="text-xs text-slate-400">
            {t("help.localSuite.overview.subtitle")}
          </p>
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <article
              key={`overview-${index}`}
              className="rounded-2xl border border-white/10 bg-slate-950/70 p-4"
            >
              <h3 className="text-sm font-semibold text-white">
                {t(`help.localSuite.overview.cards.${index}.title`)}
              </h3>
              <p className="mt-2 text-xs text-slate-300">
                {t(`help.localSuite.overview.cards.${index}.description`)}
              </p>
              <ul className="mt-3 space-y-2 text-xs text-slate-400">
                {Array.from({ length: 3 }).map((_, bulletIndex) => (
                  <li
                    key={`overview-${index}-${bulletIndex}`}
                    className="flex items-start gap-2"
                  >
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-teal-400" />
                    <span>
                      {t(
                        `help.localSuite.overview.cards.${index}.bullets.${bulletIndex}`,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-white">
            {t("help.localSuite.paths.title")}
          </p>
          <p className="text-xs text-slate-400">
            {t("help.localSuite.paths.subtitle")}
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-teal-300">
              {t("help.localSuite.paths.recommended.kicker")}
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">
              {t("help.localSuite.paths.recommended.title")}
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              {t("help.localSuite.paths.recommended.body")}
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              {t("help.localSuite.paths.recommended.stepsTitle")}
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              {Array.from({ length: 4 }).map((_, stepIndex) => (
                <li
                  key={`recommended-step-${stepIndex}`}
                  className="flex items-start gap-2"
                >
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-teal-400" />
                  <span>
                    {t(`help.localSuite.paths.recommended.steps.${stepIndex}`)}
                  </span>
                </li>
              ))}
            </ul>
            <a
              href="#local-suite-downloads"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-teal-300/40 bg-teal-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-200 transition hover:-translate-y-0.5 hover:border-teal-200/70 hover:bg-teal-400/20"
            >
              {t("help.localSuite.paths.recommended.cta")}
              <span className="text-base">→</span>
            </a>
          </article>
          <article className="rounded-3xl border border-white/10 bg-slate-950/60 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">
              {t("help.localSuite.paths.advanced.kicker")}
            </p>
            <h3 className="mt-3 text-lg font-semibold text-white">
              {t("help.localSuite.paths.advanced.title")}
            </h3>
            <p className="mt-2 text-sm text-slate-300">
              {t("help.localSuite.paths.advanced.body")}
            </p>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              {t("help.localSuite.paths.advanced.stepsTitle")}
            </p>
            <ul className="mt-3 space-y-2 text-xs text-slate-300">
              {Array.from({ length: 3 }).map((_, stepIndex) => (
                <li
                  key={`advanced-step-${stepIndex}`}
                  className="flex items-start gap-2"
                >
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-teal-400" />
                  <span>
                    {t(`help.localSuite.paths.advanced.steps.${stepIndex}`)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
              {t("help.localSuite.paths.advanced.codeTitle")}
            </p>
            <pre className="mt-3 whitespace-pre-wrap rounded-2xl border border-white/10 bg-slate-950/80 px-4 py-3 text-[11px] text-teal-200">
              {t("help.localSuite.paths.advanced.code")}
            </pre>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">
                  {t("help.localSuite.paths.advanced.docs.title")}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  {t("help.localSuite.paths.advanced.docs.body", {
                    url: DEFAULT_LOCAL_DOCS_URL,
                  })}
                </p>
              </div>
              <a
                href={DEFAULT_LOCAL_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-teal-200 transition hover:-translate-y-0.5 hover:border-white/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              >
                {t("help.localSuite.paths.advanced.docs.cta")}
                <span className="text-base">↗</span>
              </a>
            </div>
          </article>
        </div>
      </section>

      <section
        id="local-suite-downloads"
        className="rounded-3xl border border-white/10 bg-slate-950/60 p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">
              {t("help.localSuite.downloads.title")}
            </p>
            <p className="text-xs text-slate-400">
              {t("help.localSuite.downloads.subtitle")}
            </p>
          </div>
          {releaseError ? (
            <span className="text-xs text-amber-300" role="status">
              {releaseError}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {downloads.map((download) =>
            download.href ? (
              <a
                key={download.platform}
                href={download.href}
                className="flex min-h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
              >
                <span>{download.label}</span>
                <span className="text-xs text-slate-300">
                  {download.statusLabel ?? t("help.localSuite.downloads.ready")}
                </span>
              </a>
            ) : (
              <div
                key={download.platform}
                className="flex min-h-12 items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-400"
                aria-disabled="true"
              >
                <span>{download.label}</span>
                <span className="text-xs text-slate-500">
                  {download.statusLabel ??
                    t("help.localSuite.downloads.pending")}
                </span>
              </div>
            ),
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">
              {t("help.localSuite.catalog.title")}
            </p>
            <p className="text-xs text-slate-400">
              {t("help.localSuite.catalog.subtitle")}
            </p>
            <p className="mt-2 max-w-2xl text-xs text-amber-200">
              {t("help.localSuite.catalog.platformNote")}
            </p>
          </div>
          <div className="flex min-h-11 w-full items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 px-4 py-2 focus-within:border-teal-300 sm:w-80">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
              />
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
            <article
              key={model.id}
              className="rounded-3xl border border-white/10 bg-slate-950/60 p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">
                    {model.display.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {model.display.description}
                  </p>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-full border border-white/10 px-3 py-2 text-xs text-slate-200 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300"
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
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.endpoint")}
                  </p>
                  <p>{model.api.endpoint}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.backend")}
                  </p>
                  <p>{model.backend.provider}</p>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.platform")}
                  </p>
                  <p>
                    {model.compat.platforms
                      .map((platform) => PLATFORM_LABELS[platform] ?? platform)
                      .join(", ")}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.acceleration")}
                  </p>
                  <p>
                    {model.compat.acceleration
                      .map(
                        (acceleration) =>
                          ACCELERATION_LABELS[acceleration] ?? acceleration,
                      )
                      .join(", ")}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.resources")}
                  </p>
                  <p>
                    {t("help.localSuite.catalog.ram", {
                      value: model.compat.requires_ram_gb,
                    })}
                    {model.compat.requires_vram_gb
                      ? ` / ${t("help.localSuite.catalog.vram", { value: model.compat.requires_vram_gb })}`
                      : ""}{" "}
                    /{" "}
                    {t("help.localSuite.catalog.disk", {
                      value: model.compat.disk_gb,
                    })}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-white">
                    {t("help.localSuite.catalog.constraints")}
                  </p>
                  <p>
                    {t("help.localSuite.catalog.inputLimit", {
                      value: model.limits.max_input_mb,
                    })}{" "}
                    ·{" "}
                    {t("help.localSuite.catalog.tokenLimit", {
                      value: model.limits.max_output_tokens_default,
                    })}
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
