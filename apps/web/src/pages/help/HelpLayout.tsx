import { NavLink, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

type HelpContext = {
  openAiSetup?: () => void;
};

const helpPages = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Start practicing in minutes with a guided setup.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    )
  },
  {
    slug: "how-it-works",
    title: "What the app is doing",
    description: "Follow the end-to-end coaching loop.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M7 7h10M7 12h6M7 17h4M4 4h16v16H4z"
        />
      </svg>
    )
  },
  {
    slug: "deliberate-practice",
    title: "What is deliberate practice",
    description: "Sharpen micro-skills with targeted feedback.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 20l14-8-14-8v16z" />
      </svg>
    )
  },
  {
    slug: "about",
    title: "About",
    description: "Product overview and privacy posture.",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8h.01M12 12v4m8-4a8 8 0 1 1-16 0a8 8 0 0 1 16 0Z" />
      </svg>
    )
  }
];

export const HelpLayout = () => {
  const location = useLocation();
  const parentContext = useOutletContext<HelpContext | undefined>() ?? {};
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredPages = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return helpPages;
    return helpPages.filter((page) =>
      `${page.title} ${page.description}`.toLowerCase().includes(normalized)
    );
  }, [query]);

  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isDrawerOpen]);

  const renderNav = (isMobile = false) => (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
        <label className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400" htmlFor={isMobile ? "help-search-mobile" : "help-search"}>
          Find answers
        </label>
        <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
          </svg>
          <input
            id={isMobile ? "help-search-mobile" : "help-search"}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help topics"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
        </div>
      </div>
      <nav className="space-y-2" aria-label="Help sections">
        {filteredPages.map((page) => (
          <NavLink
            key={page.slug}
            to={`/help/${page.slug}`}
            className={({ isActive }) =>
              `group relative flex items-start gap-3 rounded-2xl border border-transparent px-3 py-3 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70 ${
                isActive
                  ? "border-white/10 bg-white/10 text-white"
                  : "text-slate-300 hover:border-white/10 hover:bg-white/5"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-3 h-8 w-1 rounded-full bg-teal-400 transition ${
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                  }`}
                />
                <span className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-slate-900/70 text-teal-200">
                  {page.icon}
                </span>
                <span className="space-y-1">
                  <span className="block font-semibold text-white/90">{page.title}</span>
                  <span className="block text-xs text-slate-400">{page.description}</span>
                </span>
              </>
            )}
          </NavLink>
        ))}
        {filteredPages.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-4 text-xs text-slate-400">
            No matches. Try another keyword.
          </div>
        ) : null}
      </nav>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 lg:hidden">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Help portal</p>
          <p className="text-lg font-semibold text-white">Need guidance?</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
          onClick={() => setIsDrawerOpen(true)}
          aria-label="Open help navigation"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          Menu
        </button>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <aside className="hidden w-80 shrink-0 lg:block">
          <div className="sticky top-24 space-y-6">
            {renderNav()}
            <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-teal-500/10 via-slate-900/60 to-slate-950/80 p-5 text-sm text-slate-200">
              <p className="text-xs uppercase tracking-[0.3em] text-teal-300">Need more?</p>
              <p className="mt-2 font-semibold text-white">Reach out to your admin lead.</p>
              <p className="mt-2 text-xs text-slate-400">
                We keep the help center updated for core workflows. Team-specific policies live in your internal docs.
              </p>
            </div>
          </div>
        </aside>

        <section className="flex-1">
          <div
            key={location.pathname}
            className="animate-[helpFadeSlide_0.35s_ease] space-y-6 motion-reduce:animate-none"
          >
            <Outlet context={parentContext} />
          </div>
        </section>
      </div>

      {isDrawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" aria-hidden={!isDrawerOpen}>
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur"
            onClick={() => setIsDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Help navigation"
            className="absolute inset-x-4 top-6 rounded-3xl border border-white/10 bg-slate-950/95 p-4 shadow-2xl shadow-black/40"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">Browse help topics</p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/70"
                onClick={() => setIsDrawerOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 max-h-[70vh] overflow-y-auto pr-2">{renderNav(true)}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
