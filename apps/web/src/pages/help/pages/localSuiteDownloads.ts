export type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

export type DownloadPlatform =
  "windows-x64" | "darwin-arm64" | "darwin-x64" | "linux-x64";

const ARCHITECTURE_PATTERNS: Record<DownloadPlatform, RegExp> = {
  "windows-x64": /(?:^|[._-])(?:x64|x86_64|amd64)(?:[._-]|$)/,
  "darwin-arm64": /(?:^|[._-])(?:aarch64|arm64)(?:[._-]|$)/,
  "darwin-x64": /(?:^|[._-])(?:x64|x86_64|intel)(?:[._-]|$)/,
  "linux-x64": /(?:^|[._-])(?:x64|x86_64|amd64)(?:[._-]|$)/,
};

const PACKAGE_PRIORITY: Record<DownloadPlatform, RegExp[]> = {
  "windows-x64": [/-setup\.exe$/, /\.msi$/],
  "darwin-arm64": [/\.dmg$/],
  "darwin-x64": [/\.dmg$/],
  "linux-x64": [/\.appimage$/, /\.deb$/, /\.rpm$/],
};

export const assetMatchesPlatform = (
  assetName: string,
  platform: DownloadPlatform,
) => {
  const normalized = assetName.toLowerCase();
  return (
    ARCHITECTURE_PATTERNS[platform].test(normalized) &&
    PACKAGE_PRIORITY[platform].some((pattern) => pattern.test(normalized))
  );
};

export const findDownloadAsset = (
  assets: ReleaseAsset[],
  platform: DownloadPlatform,
) => {
  const matching = assets.filter((asset) =>
    assetMatchesPlatform(asset.name, platform),
  );
  for (const packagePattern of PACKAGE_PRIORITY[platform]) {
    const preferred = matching.find((asset) =>
      packagePattern.test(asset.name.toLowerCase()),
    );
    if (preferred) return preferred;
  }
  return undefined;
};
