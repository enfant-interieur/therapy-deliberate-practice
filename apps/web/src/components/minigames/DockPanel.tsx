import { useState } from "react";
import type { ReactNode } from "react";

export type DockPanelProps = {
  side: "left" | "right";
  title: string;
  icon: ReactNode;
  defaultCollapsed?: boolean;
  collapsedWidth?: number;
  expandedWidth?: number;
  behavior?: "dock" | "stack";
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  children: ReactNode;
};

export const DockPanel = ({
  side,
  title,
  icon,
  defaultCollapsed = false,
  collapsedWidth = 56,
  expandedWidth = 360,
  behavior = "dock",
  collapsed,
  onCollapsedChange,
  children
}: DockPanelProps) => {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed);
  const isCollapsed = typeof collapsed === "boolean" ? collapsed : internalCollapsed;
  const toggle = () => {
    const next = !isCollapsed;
    if (collapsed == null) {
      setInternalCollapsed(next);
    }
    onCollapsedChange?.(next);
  };

  const contentTranslate =
    side === "left" ? (isCollapsed ? "-translate-x-4" : "translate-x-0") : isCollapsed ? "translate-x-4" : "translate-x-0";
  const contentVisibility = isCollapsed
    ? "flex-none max-h-0 overflow-hidden opacity-0 pointer-events-none"
    : "flex-1 opacity-100";
  const contentHeight = isCollapsed ? "max-h-0" : "max-h-[80vh]";
  const contentOverflow = !isCollapsed ? "overflow-y-auto" : "";
  const contentPadding = isCollapsed ? "p-0" : "p-4";

  const widthStyle =
    behavior === "dock"
      ? { width: isCollapsed ? `${collapsedWidth}px` : `${expandedWidth}px` }
      : undefined;

  return (
    <section
      className={`relative flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-900/60 shadow-[0_0_25px_rgba(15,23,42,0.45)] backdrop-blur transition-[width] duration-300 ease-out ${
        behavior === "stack" ? "w-full" : ""
      }`}
      style={widthStyle}
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!isCollapsed}
        className={`group flex w-full items-center gap-3 border-b border-white/10 bg-white/5 text-left transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-teal-300/40 ${
          isCollapsed
            ? "flex-col px-2 py-4"
            : "flex-row justify-between px-4 py-3"
        }`}
      >
        <span className={`flex items-center gap-2 ${isCollapsed ? "flex-col" : ""}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-100">
            {icon}
          </span>
          <span
            className={`text-xs font-semibold uppercase tracking-[0.35em] text-slate-200 ${
              isCollapsed ? "md:[writing-mode:vertical-rl]" : ""
            }`}
          >
            {title}
          </span>
        </span>
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-200 transition group-hover:border-white/30 ${
            isCollapsed ? "rotate-0" : side === "left" ? "-rotate-90" : "rotate-90"
          }`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      <div
        aria-hidden={isCollapsed}
        className={`transition-[opacity,transform,max-height] duration-300 ease-out ${contentVisibility} ${
          behavior === "stack" ? contentHeight : ""
        } ${behavior === "dock" ? contentTranslate : ""} ${contentOverflow}`}
      >
        <div className={contentPadding}>{children}</div>
      </div>
    </section>
  );
};
