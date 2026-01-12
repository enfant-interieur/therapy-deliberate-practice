import { writeFileSync } from "node:fs";
import semver from "semver";

export function assertManifestVersion(manifestVersion) {
  const normalized = semver.valid(manifestVersion);
  if (!normalized) {
    throw new Error(
      `tauri.conf.json version "${manifestVersion}" is not valid semver. ` +
        "Use MAJOR.MINOR.PATCH (optionally with pre-release/build metadata).",
    );
  }
  return normalized;
}

export function resolveReleaseVersion({ manifestVersion, requestedTag }) {
  const normalizedManifest = assertManifestVersion(manifestVersion);
  if (!requestedTag) {
    return {
      tag: `v${normalizedManifest}`,
      releaseVersion: normalizedManifest,
      bumpRequired: false,
    };
  }

  const cleanedTagVersion = semver.clean(requestedTag);
  if (!cleanedTagVersion) {
    throw new Error(
      `Invalid release tag "${requestedTag}". Use vMAJOR.MINOR.PATCH (optionally with pre-release/build metadata).`,
    );
  }

  if (semver.lt(cleanedTagVersion, normalizedManifest)) {
    throw new Error(
      `Requested tag ${requestedTag} resolves to ${cleanedTagVersion}, which is older than the manifest version ${normalizedManifest}. ` +
        "Bump tauri.conf.json or pick a newer tag.",
    );
  }

  return {
    tag: requestedTag,
    releaseVersion: cleanedTagVersion,
    bumpRequired: semver.gt(cleanedTagVersion, normalizedManifest),
  };
}

export function persistManifestVersion(tauriConfPath, tauriConfig, newVersion) {
  const updated = { ...tauriConfig, version: newVersion };
  writeFileSync(tauriConfPath, `${JSON.stringify(updated, null, 2)}\n`);
}
