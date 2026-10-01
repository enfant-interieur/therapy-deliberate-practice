import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
  cwd: resolve(import.meta.dirname, ".."),
  encoding: "utf8",
});
if (audit.error) throw audit.error;
let report;
try {
  report = JSON.parse(audit.stdout);
} catch {
  throw new Error("npm audit did not return valid JSON.");
}
if (
  report.error ||
  !report.metadata?.vulnerabilities ||
  ![0, 1].includes(audit.status)
) {
  throw new Error("Production dependency audit could not complete.");
}
const rejected = Object.entries(report.vulnerabilities ?? {})
  .filter(([, vulnerability]) =>
    ["high", "critical"].includes(vulnerability.severity),
  )
  .map(([packageName, vulnerability]) => ({
    packageName,
    severity: vulnerability.severity,
  }));
if (rejected.length) {
  console.error(
    "Production dependencies contain High or Critical advisories:",
    JSON.stringify(rejected),
  );
  process.exit(1);
}
console.log(
  "Production dependency audit passed: no High or Critical advisories.",
);
