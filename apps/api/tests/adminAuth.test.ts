import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import type { RuntimeEnv } from "../src/env";
import {
  hasAdminAllowlist,
  isAdminAllowed,
  isCloudflareAccessIssuer,
  resolveAdminStatus,
} from "../src/middleware/adminAuth";

const env = (
  overrides: Partial<Pick<RuntimeEnv, "adminEmails" | "adminGroups">> = {},
) =>
  ({
    adminEmails: [],
    adminGroups: [],
    ...overrides,
  }) as RuntimeEnv;

test("administrator authorization fails closed without an allowlist", () => {
  const configuration = env();
  assert.equal(hasAdminAllowlist(configuration), false);
  assert.equal(
    isAdminAllowed(configuration, "curator@example.com", ["curators"]),
    false,
  );
});

test("administrator authorization accepts explicitly allowed email or group only", () => {
  const configuration = env({
    adminEmails: ["curator@example.com"],
    adminGroups: ["therapy-curators"],
  });
  assert.equal(hasAdminAllowlist(configuration), true);
  assert.equal(isAdminAllowed(configuration, "CURATOR@example.com", []), true);
  assert.equal(
    isAdminAllowed(configuration, "other@example.com", ["therapy-curators"]),
    true,
  );
  assert.equal(
    isAdminAllowed(configuration, "other@example.com", ["learners"]),
    false,
  );
});

test("administrator Access verification pins the configured issuer and rejects malformed tokens", async () => {
  const configuration = {
    ...env({
      adminEmails: ["curator@example.com"],
    }),
    cfAccessAud: "expected-audience",
    cfAccessIssuer: "https://therapy-team.cloudflareaccess.com",
    environment: "production",
    bypassAdminAuth: false,
  };
  assert.equal(
    isCloudflareAccessIssuer(
      "https://attacker.example/?next=.cloudflareaccess.com",
    ),
    false,
  );
  assert.equal(isCloudflareAccessIssuer(configuration.cfAccessIssuer), true);

  const maliciousToken = await new SignJWT({ email: "curator@example.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("https://attacker.example/?next=.cloudflareaccess.com")
    .setAudience(configuration.cfAccessAud)
    .sign(new TextEncoder().encode("attacker-controlled-key"));
  const malicious = await resolveAdminStatus(
    configuration,
    new Headers({ "cf-access-jwt-assertion": maliciousToken }),
  );
  assert.deepEqual(malicious, {
    ok: false,
    status: 401,
    message: "Invalid Access issuer",
  });

  const malformed = await resolveAdminStatus(
    configuration,
    new Headers({ "cf-access-jwt-assertion": "not-a-jwt" }),
  );
  assert.deepEqual(malformed, {
    ok: false,
    status: 401,
    message: "Invalid Access token",
  });
});
