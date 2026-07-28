const MAX_SOURCE_BYTES = 512 * 1024;
const SOURCE_FETCH_TIMEOUT_MS = 5_000;
const MAX_SOURCE_REDIRECTS = 3;

const ACCEPTED_SOURCE_CONTENT_TYPES = new Set([
  "text/html",
  "text/plain",
  "application/xhtml+xml",
]);

export type SourceAddressResolver = (hostname: string) => Promise<string[]>;
export type SourceFetchTransport = (request: {
  url: string;
  validatedAddresses: readonly string[];
  init: RequestInit;
}) => Promise<Response>;

export type AdminSourceFetchDependencies = {
  resolveHostname: SourceAddressResolver;
  /**
   * This is deliberately not the global Fetch signature. The adapter must connect
   * to one of validatedAddresses while preserving the URL host for HTTP Host and
   * TLS SNI. Passing global fetch here would re-resolve the hostname and reopen a
   * DNS rebinding time-of-check/time-of-use gap.
   */
  fetchValidated: SourceFetchTransport;
};

export class AdminSourceFetchError extends Error {
  constructor(
    public readonly code:
      | "invalid_url"
      | "forbidden_destination"
      | "redirect_limit"
      | "timeout"
      | "fetch_failed"
      | "bad_status"
      | "unsupported_content_type"
      | "source_too_large",
    message: string,
  ) {
    super(message);
    this.name = "AdminSourceFetchError";
  }
}

const parseIpv4 = (value: string): number[] | null => {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (
    octets.some(
      (octet, index) =>
        !Number.isInteger(octet) ||
        octet < 0 ||
        octet > 255 ||
        String(octet) !== parts[index],
    )
  ) {
    return null;
  }
  return octets;
};

const parseIpv6 = (value: string): number[] | null => {
  const normalized =
    value
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .split("%")[0] ?? "";
  if (!normalized.includes(":")) return null;

  const [headPart, tailPart, ...extra] = normalized.split("::");
  if (extra.length > 0) return null;
  const head = headPart ? headPart.split(":") : [];
  const tail = tailPart ? tailPart.split(":") : [];

  const expandEmbeddedIpv4 = (parts: string[]) => {
    const result: string[] = [];
    for (const part of parts) {
      const ipv4 = parseIpv4(part);
      if (!ipv4) {
        result.push(part);
        continue;
      }
      result.push(
        ((ipv4[0]! << 8) | ipv4[1]!).toString(16),
        ((ipv4[2]! << 8) | ipv4[3]!).toString(16),
      );
    }
    return result;
  };

  const expandedHead = expandEmbeddedIpv4(head);
  const expandedTail = expandEmbeddedIpv4(tail);
  const omitted = 8 - expandedHead.length - expandedTail.length;
  if (
    (tailPart === undefined && omitted !== 0) ||
    (tailPart !== undefined && omitted < 1)
  ) {
    return null;
  }
  const groups = [
    ...expandedHead,
    ...Array.from({ length: Math.max(0, omitted) }, () => "0"),
    ...expandedTail,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.map((group) => Number.parseInt(group, 16));
};

export const isPublicSourceAddress = (address: string): boolean => {
  const ipv4 = parseIpv4(address);
  if (ipv4) {
    const [a, b, c] = ipv4;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b! >= 64 && b! <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a! >= 224
    );
  }

  const ipv6 = parseIpv6(address);
  if (!ipv6) return false;
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = ipv6;
  const isUnspecified = ipv6.every((group) => group === 0);
  const isLoopback =
    ipv6.slice(0, 7).every((group) => group === 0) && eighth === 1;
  const isIpv4Mapped =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    sixth === 0xffff;
  if (isIpv4Mapped) {
    return isPublicSourceAddress(
      `${seventh! >> 8}.${seventh! & 255}.${eighth! >> 8}.${eighth! & 255}`,
    );
  }
  const isGlobalUnicast = (first! & 0xe000) === 0x2000;
  const isTeredo = first === 0x2001 && second === 0;
  const isSixToFour = first === 0x2002;
  return !(
    !isGlobalUnicast ||
    isTeredo ||
    isSixToFour ||
    isUnspecified ||
    isLoopback ||
    (first! & 0xfe00) === 0xfc00 ||
    (first! & 0xffc0) === 0xfe80 ||
    (first! & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8)
  );
};

const validateSourceUrl = async (
  value: string,
  resolveHostname: SourceAddressResolver,
): Promise<{ url: URL; addresses: string[] }> => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AdminSourceFetchError(
      "invalid_url",
      "The source URL is invalid.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new AdminSourceFetchError(
      "invalid_url",
      "The source URL must use HTTP or HTTPS without credentials.",
    );
  }
  if (!url.hostname) {
    throw new AdminSourceFetchError(
      "invalid_url",
      "The source URL has no hostname.",
    );
  }

  let addresses: string[];
  try {
    addresses = await resolveHostname(url.hostname);
  } catch {
    throw new AdminSourceFetchError(
      "forbidden_destination",
      "The source destination could not be verified.",
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some((address) => !isPublicSourceAddress(address))
  ) {
    throw new AdminSourceFetchError(
      "forbidden_destination",
      "The source destination is not permitted.",
    );
  }
  return { url, addresses };
};

const isRedirectStatus = (status: number) =>
  status === 301 ||
  status === 302 ||
  status === 303 ||
  status === 307 ||
  status === 308;

const parseContentType = (value: string | null) =>
  value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const readBoundedText = async (
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AdminSourceFetchError(
      "source_too_large",
      "The source document is too large.",
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new AdminSourceFetchError(
          "timeout",
          "The source request timed out.",
        );
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new AdminSourceFetchError(
          "source_too_large",
          "The source document is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
};

const withDeadline = async <T>(
  operation: Promise<T>,
  controller: AbortController,
  timeoutMs: number,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(
        new AdminSourceFetchError("timeout", "The source request timed out."),
      );
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
};

export const fetchAdminSourceText = async (
  sourceUrl: string,
  dependencies: AdminSourceFetchDependencies,
  options: {
    maxBytes?: number;
    timeoutMs?: number;
    maxRedirects?: number;
  } = {},
): Promise<string> => {
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
  const timeoutMs = options.timeoutMs ?? SOURCE_FETCH_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_SOURCE_REDIRECTS;
  const controller = new AbortController();

  return withDeadline(
    (async () => {
      let current = await validateSourceUrl(
        sourceUrl,
        dependencies.resolveHostname,
      );
      for (let redirectCount = 0; ; redirectCount += 1) {
        let response: Response;
        try {
          response = await dependencies.fetchValidated({
            url: current.url.href,
            validatedAddresses: current.addresses,
            init: {
              method: "GET",
              redirect: "manual",
              signal: controller.signal,
              headers: {
                Accept: "text/html, application/xhtml+xml, text/plain;q=0.9",
              },
            },
          });
        } catch {
          if (controller.signal.aborted) {
            throw new AdminSourceFetchError(
              "timeout",
              "The source request timed out.",
            );
          }
          throw new AdminSourceFetchError(
            "fetch_failed",
            "The source request failed.",
          );
        }

        if (isRedirectStatus(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          if (redirectCount >= maxRedirects) {
            throw new AdminSourceFetchError(
              "redirect_limit",
              "The source redirected too many times.",
            );
          }
          const location = response.headers.get("location");
          if (!location) {
            throw new AdminSourceFetchError(
              "fetch_failed",
              "The source redirect is invalid.",
            );
          }
          current = await validateSourceUrl(
            new URL(location, current.url).href,
            dependencies.resolveHostname,
          );
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new AdminSourceFetchError(
            "bad_status",
            "The source returned an unsuccessful status.",
          );
        }
        const contentType = parseContentType(
          response.headers.get("content-type"),
        );
        if (!ACCEPTED_SOURCE_CONTENT_TYPES.has(contentType)) {
          await response.body?.cancel().catch(() => undefined);
          throw new AdminSourceFetchError(
            "unsupported_content_type",
            "The source content type is not supported.",
          );
        }
        return readBoundedText(response, maxBytes, controller.signal);
      }
    })(),
    controller,
    timeoutMs,
  );
};
