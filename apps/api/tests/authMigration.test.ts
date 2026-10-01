import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import Database from "better-sqlite3";
import { hashSync } from "bcryptjs";
import { prepareMigration } from "../../../scripts/auth/prepare-migration.mjs";
const id = "10000000-0000-4000-8000-000000000001";
const secondId = "10000000-0000-4000-8000-000000000002";
const stamp = "2026-09-01T00:00:00Z";
const syntheticHash = hashSync("oldpwd", 10);
const source = () => ({
  schemaVersion: 1,
  source: {
    projectRef: "synthetic",
    exportedAt: stamp,
    frozen: true,
    expectedUserCount: 1,
    expectedIdentityCount: 2,
  },
  users: [
    {
      id,
      email: "learner@example.com",
      encrypted_password: syntheticHash,
      email_confirmed_at: stamp,
      created_at: stamp,
      updated_at: stamp,
      banned_until: null,
      deleted_at: null,
      is_anonymous: false,
      is_sso_user: false,
      phone: null,
      phone_confirmed_at: null,
    },
  ],
  identities: [
    {
      id: "email-row",
      user_id: id,
      provider: "email",
      provider_id: id,
      created_at: stamp,
      updated_at: stamp,
    },
    {
      id: "row-is-not-subject",
      user_id: id,
      provider: "google",
      provider_id: "immutable-google-subject",
      subject: "immutable-google-subject",
      created_at: stamp,
      updated_at: stamp,
    },
  ],
  mfaFactors: [],
});
const snapshot = (file = ":memory:") => {
  const db = new Database(file);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT,name TEXT);");
  db.prepare("INSERT INTO users VALUES (?,?,?)").run(
    id,
    "learner@example.com",
    "Existing name",
  );
  db.exec(
    readFileSync(
      new URL(
        "../../worker/migrations/0019_application_auth.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
};

test("migration maps immutable provider subjects, preserves confirmation and retries interrupted additive SQL", () => {
  const db = snapshot();
  try {
    const data = source();
    const prepared = prepareMigration(data, db);
    const statements = prepared.sql
      .split("\n")
      .filter((line) => line.startsWith("INSERT"));
    db.exec(statements[0]); // An interruption after the first imported user is recoverable.
    const retry = prepareMigration(data, db);
    db.exec(retry.sql);
    db.exec(retry.sql);
    assert.equal(
      db
        .prepare(
          "SELECT account_id FROM auth_account WHERE provider_id='google'",
        )
        .get().account_id,
      "immutable-google-subject",
    );
    assert.equal(
      db.prepare("SELECT name FROM users WHERE id=?").get(id).name,
      "Existing name",
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM auth_user").get().n, 1);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM auth_account").get().n,
      2,
    );
    assert.equal(
      prepareMigration(data, db).receipt.counts.alreadyImportedAccounts,
      2,
    );
    const unconfirmed = snapshot();
    try {
      const pending = source();
      pending.users[0].email_confirmed_at = null as unknown as string;
      unconfirmed.exec(prepareMigration(pending, unconfirmed).sql);
      assert.equal(
        unconfirmed.prepare("SELECT email_verified FROM auth_user").get()
          .email_verified,
        0,
      );
    } finally {
      unconfirmed.close();
    }
  } finally {
    db.close();
  }
});

test("migration rejects normalized email collisions, owner/subject conflicts, incomplete metadata and unsupported security", () => {
  const db = snapshot();
  try {
    const cases = [
      (s: ReturnType<typeof source>) => {
        s.users.push({
          ...s.users[0],
          id: secondId,
          email: "LEARNER@example.com",
        });
        s.source.expectedUserCount++;
      },
      (s: ReturnType<typeof source>) => {
        s.identities.push({ ...s.identities[1], id: "another-row" });
        s.source.expectedIdentityCount++;
      },
      (s: ReturnType<typeof source>) => {
        s.users[0].encrypted_password = "$2b$31$" + "a".repeat(53);
      },
      (s: ReturnType<typeof source>) => {
        s.users[0].banned_until = "2030-01-01T00:00:00Z" as unknown as null;
      },
      (s: ReturnType<typeof source>) => {
        s.mfaFactors.push({ id: "mfa" } as never);
      },
      (s: ReturnType<typeof source>) => {
        s.identities[1].provider = "saml";
      },
      (s: ReturnType<typeof source>) => {
        s.identities[1].provider_id = "";
      },
      (s: ReturnType<typeof source>) => {
        s.identities[1].subject = "a-different-subject";
      },
      (s: ReturnType<typeof source>) => {
        s.source.expectedUserCount++;
      },
      (s: ReturnType<typeof source>) => {
        s.users[0].id = secondId;
      },
      (s: ReturnType<typeof source>) => {
        delete (s.users[0] as Partial<(typeof s.users)[0]>).phone;
      },
    ];
    for (const change of cases) {
      const s = source();
      change(s);
      assert.throws(() => prepareMigration(s, db));
      assert.equal(
        db.prepare("SELECT count(*) AS n FROM auth_user").get().n,
        0,
      );
    }
    const prepared = prepareMigration(source(), db);
    db.exec(prepared.sql);
    db.prepare(
      "UPDATE auth_account SET account_id='different' WHERE provider_id='google'",
    ).run();
    assert.throws(
      () => prepareMigration(source(), db),
      /EXISTING_AUTH_ACCOUNT_COLLISION/,
    );
  } finally {
    db.close();
  }
});

test("migration CLI defaults to aggregate dry-run and writes exclusive0600 private output without source values", () => {
  const privateRoot = mkdtempSync(join(tmpdir(), "therapy-private-migration-"));
  chmodSync(privateRoot, 0o700);
  const sourcePath = join(privateRoot, "source.json");
  const snapshotPath = join(privateRoot, "application.sqlite");
  const outputPath = join(privateRoot, "import.sql");
  writeFileSync(sourcePath, JSON.stringify(source()), { mode: 0o600 });
  const db = snapshot(snapshotPath);
  db.close();
  chmodSync(snapshotPath, 0o600);
  const script = new URL(
    "../../../scripts/auth/prepare-migration.mjs",
    import.meta.url,
  ).pathname;
  const args = [script, "--source", sourcePath, "--snapshot", snapshotPath];
  const env = { ...process.env, AUTH_MIGRATION_PRIVATE_ROOT: privateRoot };
  const dry = execFileSync(process.execPath, args, { env, encoding: "utf8" });
  assert.equal(JSON.parse(dry).mode, "dry-run");
  assert.equal(dry.includes("learner@example.com"), false);
  assert.equal(dry.includes(syntheticHash), false);
  const written = execFileSync(
    process.execPath,
    [...args, "--output", outputPath],
    { env, encoding: "utf8" },
  );
  assert.equal(JSON.parse(written).mode, "sql-prepared");
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(statSync(`${outputPath}.receipt.json`).mode & 0o777, 0o600);
  const duplicate = spawnSync(
    process.execPath,
    [...args, "--output", outputPath],
    { env, encoding: "utf8" },
  );
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /OUTPUT_ALREADY_EXISTS/);
  const publicOutput = new URL(
    "../../../docs/auth/unwanted.sql",
    import.meta.url,
  ).pathname;
  const forbidden = spawnSync(
    process.execPath,
    [...args, "--output", publicOutput],
    { env, encoding: "utf8" },
  );
  assert.equal(forbidden.status, 1);
  const missingPrivate = spawnSync(process.execPath, args, {
    env: { ...env, AUTH_MIGRATION_PRIVATE_ROOT: "" },
    encoding: "utf8",
  });
  assert.equal(missingPrivate.status, 1);
});

test("migration CLI rejects a restricted private root inside any other repository or worktree", () => {
  const script = new URL(
    "../../../scripts/auth/prepare-migration.mjs",
    import.meta.url,
  ).pathname;
  for (const worktree of [false, true]) {
    const checkout = mkdtempSync(join(tmpdir(), "therapy-other-checkout-"));
    if (worktree) writeFileSync(join(checkout, ".git"), "gitdir: /synthetic/repository\n");
    else mkdirSync(join(checkout, ".git"));
    const privateRoot = join(checkout, "restricted");
    mkdirSync(privateRoot, { mode: 0o700 });
    const sourcePath = join(privateRoot, "source.json");
    const snapshotPath = join(privateRoot, "application.sqlite");
    writeFileSync(sourcePath, JSON.stringify(source()), { mode: 0o600 });
    const db = snapshot(snapshotPath);
    db.close();
    chmodSync(snapshotPath, 0o600);
    const forbidden = spawnSync(
      process.execPath,
      [script, "--source", sourcePath, "--snapshot", snapshotPath, "--output", join(privateRoot, "import.sql")],
      { env: { ...process.env, AUTH_MIGRATION_PRIVATE_ROOT: privateRoot }, encoding: "utf8" },
    );
    assert.equal(forbidden.status, 1);
    assert.match(forbidden.stderr, /GIT_REPOSITORY_PATH_FORBIDDEN/);
    assert.equal(forbidden.stdout.includes("learner@example.com"), false);
    assert.equal(forbidden.stderr.includes(syntheticHash), false);
    assert.equal(forbidden.stdout.includes(syntheticHash), false);
  }
});
