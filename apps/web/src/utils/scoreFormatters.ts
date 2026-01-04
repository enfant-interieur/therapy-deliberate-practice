const relativeTimeUnits: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
  ["second", 1000]
];

export const formatScore = (value: number) => value.toFixed(1);

export const formatRelativeTime = (timestamp: number | null, locale: string) => {
  if (!timestamp) {
    return "—";
  }
  const now = Date.now();
  const diff = timestamp - now;
  const absolute = Math.abs(diff);
  for (const [unit, unitMs] of relativeTimeUnits) {
    if (absolute >= unitMs || unit === "second") {
      const value = Math.round(diff / unitMs);
      return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
    }
  }
  return "—";
};

export const formatDateTime = (timestamp: number | null, locale: string) => {
  if (!timestamp) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
};
