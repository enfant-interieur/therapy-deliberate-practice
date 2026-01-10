import { useState, type KeyboardEvent } from "react";
import { Label } from "./AdminUi";

type TagInputProps = {
  label: string;
  placeholder?: string;
  value: string[];
  onChange: (next: string[]) => void;
};

const normalizeTags = (tags: string[]) => {
  const seen = new Set<string>();
  return tags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const TagInput = ({ label, placeholder, value, onChange }: TagInputProps) => {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const next = normalizeTags([...value, draft]);
    if (next.length !== value.length) {
      onChange(next);
    }
    setDraft("");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && !draft && value.length) {
      event.preventDefault();
      onChange(value.slice(0, -1));
    }
  };

  const handleRemove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2">
        {value.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="flex items-center gap-2 rounded-full border border-teal-400/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-100"
          >
            {tag}
            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="text-teal-100/70 transition hover:text-white"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-w-[140px] flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
        />
      </div>
    </div>
  );
};
