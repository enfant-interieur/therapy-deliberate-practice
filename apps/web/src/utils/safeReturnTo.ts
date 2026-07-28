export const safeInternalReturnTo = (
  value: string | null,
  origin = window.location.origin,
) => {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) {
      return null;
    }
    if (parsed.pathname === "/login" || parsed.pathname === "/login/") {
      return "/";
    }
    const destination = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return destination;
  } catch {
    return null;
  }
};
