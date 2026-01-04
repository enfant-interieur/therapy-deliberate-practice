import { cloneElement, useId, type ReactElement } from "react";

type TooltipProps = {
  label: string;
  children: ReactElement;
};

export const Tooltip = ({ label, children }: TooltipProps) => {
  const id = useId();
  const describedBy = [children.props["aria-describedby"], id].filter(Boolean).join(" ");

  return (
    <span className="group relative inline-flex">
      {cloneElement(children, {
        "aria-describedby": describedBy
      })}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-slate-900/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-100 opacity-0 shadow-lg shadow-black/30 transition group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
};
