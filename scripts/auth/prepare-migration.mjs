import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  openSync,
  writeFileSync,
  closeSync,
  statSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_VERSION = "1.0.0";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bcrypt = /^\$2[aby]\$(10|11|12|13|14)\$[./A-Za-z0-9]{53}$/;
const providers = new Set(["google", "github", "apple"]);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const quote = (value) =>
  value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const fail = (code) => {
  throw new Error(code);
};
const date = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value))
    fail("INVALID_DATE");
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) fail("INVALID_DATE");
  return result;
};

export function prepareMigration(source, db, { now = Date.now() } = {}) {
  if (
    source.schemaVersion !== 1 ||
    !source.source ||
    source.source.frozen !== true ||
    typeof source.source.projectRef !== "string" ||
    !/^[a-z0-9-]{1,64}$/.test(source.source.projectRef) ||
    !Array.isArray(source.users) ||
    !Array.isArray(source.identities) ||
    !Array.isArray(source.mfaFactors)
  )
    fail("INVALID_EXPORT_CONTRACT");
  const exportedAt = date(source.source.exportedAt);
  if (
    exportedAt > now + 60_000 ||
    source.source.expectedUserCount !== source.users.length ||
    source.source.expectedIdentityCount !== source.identities.length
  )
    fail("INCOMPLETE_EXPORT");
  if (source.mfaFactors.length) fail("UNSUPPORTED_MFA_STATE");
  const sourceById = new Map(source.users.map((user) => [user.id, user]));
  const userIds = new Set();
  const emails = new Map();
  const subjectOwners = new Map();
  const users = [];
  const accounts = [];
  for (const user of source.users) {
    if (
      typeof user.id !== "string" ||
      !uuid.test(user.id) ||
      userIds.has(user.id)
    )
      fail("INVALID_OR_DUPLICATE_USER_ID");
    const email = normalizeEmail(user.email);
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      emails.has(email)
    )
      fail("INVALID_OR_DUPLICATE_EMAIL");
    if (
      user.is_anonymous !== false ||
      user.is_sso_user !== false ||
      user.deleted_at ||
      user.phone ||
      user.phone_confirmed_at ||
      (user.banned_until && date(user.banned_until) > exportedAt)
    )
      fail("UNSUPPORTED_ACCOUNT_STATE");
    // Explicit fields prevent an incomplete export from silently dropping security state.
    for (const key of [
      "encrypted_password",
      "email_confirmed_at",
      "banned_until",
      "deleted_at",
      "phone",
      "phone_confirmed_at",
    ]) {
      if (!(key in user)) fail("INCOMPLETE_SECURITY_STATE");
    }
    const createdAt = date(user.created_at);
    const updatedAt = date(user.updated_at);
    if (createdAt > updatedAt || updatedAt > exportedAt + 60_000)
      fail("INVALID_DATE_ORDER");
    if (
      user.email_confirmed_at &&
      date(user.email_confirmed_at) > exportedAt + 60_000
    )
      fail("INVALID_CONFIRMATION_DATE");
    if (user.encrypted_password && !bcrypt.test(user.encrypted_password))
      fail("UNSUPPORTED_PASSWORD_HASH");
    userIds.add(user.id);
    emails.set(email, user.id);
    users.push({
      id: user.id,
      name: email.split("@")[0],
      email,
      emailVerified: Boolean(user.email_confirmed_at),
      createdAt,
      updatedAt,
    });
    if (user.encrypted_password)
      accounts.push({
        id: `import:credential:${user.id}`,
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: user.encrypted_password,
        createdAt,
        updatedAt,
      });
  }
  const identityIds = new Set();
  const methodsByUser = new Map();
  for (const identity of source.identities) {
    if (
      !identity ||
      typeof identity.id !== "string" ||
      !identity.id ||
      identityIds.has(identity.id) ||
      !userIds.has(identity.user_id)
    )
      fail("INVALID_IDENTITY_OWNER");
    identityIds.add(identity.id);
    if (identity.provider === "email") {
      const user = sourceById.get(identity.user_id);
      if (!user?.encrypted_password) fail("EMAIL_IDENTITY_WITHOUT_PASSWORD");
      continue;
    }
    if (!providers.has(identity.provider)) fail("UNSUPPORTED_PROVIDER");
    if (
      typeof identity.provider_id !== "string" ||
      !identity.provider_id.trim() ||
      identity.provider_id.length > 1024 ||
      /[\u0000-\u001f]/.test(identity.provider_id)
    )
      fail("MISSING_PROVIDER_SUBJECT");
    if (
      identity.subject !== null &&
      identity.subject !== undefined &&
      identity.subject !== identity.provider_id
    )
      fail("PROVIDER_SUBJECT_MISMATCH");
    const key = `${identity.provider}:${identity.provider_id}`;
    if (subjectOwners.has(key)) fail("DUPLICATE_PROVIDER_SUBJECT");
    subjectOwners.set(key, identity.user_id);
    const createdAt = date(identity.created_at);
    const updatedAt = date(identity.updated_at);
    if (createdAt > updatedAt || updatedAt > exportedAt + 60_000)
      fail("INVALID_DATE_ORDER");
    accounts.push({
      id: `import:${identity.provider}:${identity.id}`,
      userId: identity.user_id,
      providerId: identity.provider,
      accountId: identity.provider_id,
      password: null,
      createdAt,
      updatedAt,
    });
  }
  for (const account of accounts)
    methodsByUser.set(
      account.userId,
      (methodsByUser.get(account.userId) ?? 0) + 1,
    );
  if (users.some((user) => !methodsByUser.has(user.id)))
    fail("ACCOUNT_WITHOUT_SUPPORTED_SIGN_IN_METHOD");
  const tables = new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  if (!tables.has("users")) fail("INVALID_APPLICATION_SNAPSHOT");
  const profileRows = db.prepare("SELECT id,email FROM users").all();
  const profileEmailOwners = new Map();
  for (const profile of profileRows) {
    const email = normalizeEmail(profile.email);
    if (!userIds.has(profile.id)) fail("MISSING_APPLICATION_USER_COVERAGE");
    if (
      emails.get(email) !== profile.id ||
      (profileEmailOwners.has(email) &&
        profileEmailOwners.get(email) !== profile.id)
    )
      fail("APPLICATION_ID_EMAIL_COLLISION");
    profileEmailOwners.set(email, profile.id);
  }
  // Existing auth rows must be identical, rather than being silently skipped by idempotent SQL.
  let alreadyImportedUsers = 0;
  let alreadyImportedAccounts = 0;
  if (tables.has("auth_user")) {
    for (const row of db
      .prepare("SELECT id,email,email_verified FROM auth_user")
      .all()) {
      const expected = users.find((user) => user.id === row.id);
      if (
        !expected ||
        expected.email !== row.email ||
        Number(expected.emailVerified) !== row.email_verified
      )
        fail("EXISTING_AUTH_USER_COLLISION");
      alreadyImportedUsers++;
    }
  }
  if (tables.has("auth_account")) {
    for (const row of db
      .prepare(
        "SELECT id,user_id,provider_id,account_id,password FROM auth_account",
      )
      .all()) {
      const expected = accounts.find((account) => account.id === row.id);
      if (
        !expected ||
        expected.userId !== row.user_id ||
        expected.providerId !== row.provider_id ||
        expected.accountId !== row.account_id ||
        expected.password !== row.password
      )
        fail("EXISTING_AUTH_ACCOUNT_COLLISION");
      alreadyImportedAccounts++;
    }
  }
  users.sort((a, b) => a.id.localeCompare(b.id));
  accounts.sort((a, b) => a.id.localeCompare(b.id));
  const lines = [
    "-- Therapy application-auth additive import; apply only under the documented account freeze.",
    "PRAGMA foreign_keys = ON;",
  ];
  for (const user of users)
    lines.push(
      `INSERT INTO auth_user (id,name,email,email_verified,created_at,updated_at) VALUES (${quote(user.id)},${quote(user.name)},${quote(user.email)},${Number(user.emailVerified)},${user.createdAt},${user.updatedAt}) ON CONFLICT(id) DO NOTHING;`,
    );
  for (const account of accounts)
    lines.push(
      `INSERT INTO auth_account (id,user_id,provider_id,account_id,password,created_at,updated_at) VALUES (${quote(account.id)},${quote(account.userId)},${quote(account.providerId)},${quote(account.accountId)},${quote(account.password)},${account.createdAt},${account.updatedAt}) ON CONFLICT(id) DO NOTHING;`,
    );
  const counts = {
    users: users.length,
    verifiedUsers: users.filter((user) => user.emailVerified).length,
    accounts: accounts.length,
    credentials: accounts.filter(
      (account) => account.providerId === "credential",
    ).length,
    google: accounts.filter((account) => account.providerId === "google")
      .length,
    github: accounts.filter((account) => account.providerId === "github")
      .length,
    apple: accounts.filter((account) => account.providerId === "apple").length,
    existingApplicationUsers: profileRows.length,
    alreadyImportedUsers,
    alreadyImportedAccounts,
  };
  return {
    sql: `${lines.join("\n")}\n`,
    receipt: {
      toolVersion: TOOL_VERSION,
      schemaVersion: 1,
      sourceProjectRef: source.source.projectRef,
      exportedAt: source.source.exportedAt,
      counts,
    },
  };
}

function assertPrivatePath(path, isOutput = false) {
  const resolved = isOutput
    ? join(
        realpathSync(dirname(resolve(path))),
        resolve(path).split(/[\\/]/).at(-1),
      )
    : realpathSync(path);
  // Require an explicit restricted working boundary outside every Git checkout.
  // A directory's permissions or remote name cannot establish repository privacy.
  const privateRoot = process.env.AUTH_MIGRATION_PRIVATE_ROOT;
  if (!privateRoot) fail("PRIVATE_ROOT_REQUIRED");
  const root = realpathSync(privateRoot);
  if (statSync(root).mode & 0o077)
    fail("PRIVATE_DIRECTORY_PERMISSIONS_REQUIRED");
  const rel = relative(root, resolved);
  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    resolve(root, rel) !== resolved
  )
    fail("OUTSIDE_PRIVATE_ROOT");
  let parent = dirname(resolved);
  while (true) {
    if (existsSync(join(parent, ".git")))
      fail("GIT_REPOSITORY_PATH_FORBIDDEN");
    if (parent === dirname(parent)) break;
    parent = dirname(parent);
  }
  const sourceRoot = realpathSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  );
  if (!relative(sourceRoot, resolved).startsWith(".."))
    fail("PUBLIC_REPOSITORY_PATH_FORBIDDEN");
  if (!isOutput && statSync(resolved).mode & 0o077)
    fail("PRIVATE_FILE_PERMISSIONS_REQUIRED");
  return resolved;
}

export function main(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !["--source", "--snapshot", "--output"].includes(argv[i]) ||
      !argv[i + 1] ||
      args[argv[i]]
    )
      fail("INVALID_ARGUMENTS");
    args[argv[i]] = argv[i + 1];
  }
  if (!args["--source"] || !args["--snapshot"])
    fail("SOURCE_AND_SNAPSHOT_REQUIRED");
  const sourcePath = assertPrivatePath(args["--source"]);
  const snapshotPath = assertPrivatePath(args["--snapshot"]);
  const sourceText = readFileSync(sourcePath, "utf8");
  const db = new Database(snapshotPath, {
    readonly: true,
    fileMustExist: true,
  });
  let result;
  try {
    result = prepareMigration(JSON.parse(sourceText), db);
  } finally {
    db.close();
  }
  const receipt = {
    ...result.receipt,
    sourceSHA256: digest(sourceText),
    snapshotSHA256: digest(readFileSync(snapshotPath)),
    sqlSHA256: digest(result.sql),
    mode: "dry-run",
  };
  if (args["--output"]) {
    const output = assertPrivatePath(args["--output"], true);
    if (existsSync(output) || existsSync(`${output}.receipt.json`))
      fail("OUTPUT_ALREADY_EXISTS");
    const fd = openSync(output, "wx", 0o600);
    try {
      writeFileSync(fd, result.sql);
    } finally {
      closeSync(fd);
    }
    const receiptFD = openSync(`${output}.receipt.json`, "wx", 0o600);
    try {
      writeFileSync(
        receiptFD,
        JSON.stringify(
          { ...receipt, mode: "sql-prepared", importId: randomUUID() },
          null,
          2,
        ) + "\n",
      );
    } finally {
      closeSync(receiptFD);
    }
    receipt.mode = "sql-prepared";
  }
  process.stdout.write(JSON.stringify(receipt) + "\n");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    // Aggregate stable codes only. Native/JSON errors may include sensitive source values.
    const code =
      error instanceof Error && /^[A-Z_]+$/.test(error.message)
        ? error.message
        : "MIGRATION_PREPARATION_FAILED";
    process.stderr.write(JSON.stringify({ error: code }) + "\n");
    process.exitCode = 1;
  }
}
