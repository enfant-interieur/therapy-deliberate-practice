import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(projectRoot, "apps", "web", "src");
const allowedPackages = new Set(["react-router", "react-router-dom"]);
const allowedAdvisories = new Set(["https://github.com/advisories/GHSA-qwww-vcr4-c8h2"]);
const exceptionExpiresAt = new Date("2026-10-01T00:00:00Z");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const forbiddenRscTokens = [
  "@react-router/",
  'from "react-router"',
  "from 'react-router'",
  "RSCHydratedRouter",
  "RSCStaticRouter",
  "routeRSCServerRequest",
  "createCallServer",
  "ServerAction"
];

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : sourceExtensions.has(extname(path))
        ? [path]
        : [];
  });
}

const boundaryViolations = [];
for (const path of sourceFiles(sourceRoot)) {
  const source = readFileSync(path, "utf8");
  for (const token of forbiddenRscTokens) {
    if (source.includes(token)) {
      boundaryViolations.push(`${relative(projectRoot, path)} contains ${JSON.stringify(token)}`);
    }
  }
}

if (boundaryViolations.length > 0) {
  console.error(
    "The temporary React Router RSC advisory exception is invalid because an RSC/server import boundary was crossed:"
  );
  console.error(boundaryViolations.join("\n"));
  process.exit(1);
}

if (Date.now() >= exceptionExpiresAt.getTime()) {
  console.error(
    `The React Router RSC advisory exception expired on ${exceptionExpiresAt.toISOString().slice(0, 10)}. ` +
      "Upgrade to a patched release or re-evaluate the boundary with a new, time-bounded decision."
  );
  process.exit(1);
}

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  cwd: projectRoot,
  encoding: "utf8"
});

if (audit.error) {
  throw audit.error;
}

let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  console.error(audit.stderr || audit.stdout);
  throw new Error("npm audit did not return valid JSON.");
}

const vulnerabilities = report.vulnerabilities ?? {};

function advisoryUrls(packageName, seen = new Set()) {
  if (seen.has(packageName)) {
    return new Set();
  }
  seen.add(packageName);

  const urls = new Set();
  for (const via of vulnerabilities[packageName]?.via ?? []) {
    if (typeof via === "string") {
      for (const url of advisoryUrls(via, seen)) {
        urls.add(url);
      }
    } else if (via?.url) {
      urls.add(via.url);
    }
  }
  return urls;
}

const rejected = [];
const accepted = [];
for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
  if (!["high", "critical"].includes(vulnerability.severity)) {
    continue;
  }

  const urls = advisoryUrls(packageName);
  const isAccepted =
    allowedPackages.has(packageName) &&
    urls.size > 0 &&
    [...urls].every((url) => allowedAdvisories.has(url));

  (isAccepted ? accepted : rejected).push({
    packageName,
    severity: vulnerability.severity,
    urls: [...urls]
  });
}

if (rejected.length > 0) {
  console.error("Production dependency audit found an unapproved High or Critical vulnerability:");
  console.error(JSON.stringify(rejected, null, 2));
  process.exit(1);
}

if (accepted.length > 0) {
  console.warn(
    `Accepted one unreachable React Router RSC advisory until ${exceptionExpiresAt
      .toISOString()
      .slice(0, 10)}; the source-boundary check passed.`
  );
}

console.log("Production dependency audit passed with no reachable High or Critical vulnerability.");
