# Application-owned authentication

The prepared application uses Better Auth 1.7.7 with the first-party Drizzle SQLite adapter. Cloudflare D1 stores accounts and sessions in production; local development uses SQLite. Google, GitHub, and Apple authenticate directly with the application. Supabase is the source of the existing account migration and remains available during the cutover and rollback period. A source commit does not mean production accounts have been transferred.

Profiles, practice history, progress, settings, minigames, audio, task data, and administrative Cloudflare Access remain in their existing application stores. Imported authentication IDs are the original Supabase UUIDs. The importer adds authentication rows and does not rewrite application records or import old sessions.

## Login and account behavior

Email registration requires confirmation before sign-in. The application includes confirmation resend, reset request, a complete new-password form, password change, sign-out, sign-out everywhere, and explicit provider linking/unlinking. Google, GitHub, and Apple appear in the interface; unavailable methods are disabled. An OAuth-only user can use email recovery to create a password for the same account.

New passwords contain 12–128 characters. They use portable PBKDF2-HMAC-SHA-256 with 600,000 iterations, a random 16-byte salt, a 32-byte derived key, and a versioned encoding. Valid imported bcrypt hashes with costs 10–14 retain their original verification semantics, including bcrypt's 72-byte limit. Unsupported hashes require remediation before import. The pinned Noble Hashes adapter preserves the same hash format and UTF-8 password semantics on Node.js and Cloudflare Workers. It yields between computation batches while retaining all iterations; both hosted native crypto interfaces reject iteration counts above 100,000. Passwords are never exported in plaintext. Local timing is evidence about the local runtime; actual Cloudflare CPU measurements remain a release gate.

Sessions last seven days and renew after one day. Sensitive account operations require verified email and a sign-in within five minutes. Production cookies are Secure, HttpOnly, SameSite=Lax, and use the `__Secure-therapy` prefix. Session state is checked against the database, without a browser cookie cache. Password reset revokes previous sessions. Learner tokens do not enter Redux or localStorage. Cookie-authenticated application mutations require an allowed Origin header; administrative Access is separate.

Email reservations use normalized lookup, unique indexes, and cross-table database guards so concurrent writes cannot claim another profile. Resolve any existing normalized profile collisions before schema migration; do not merge identities automatically. Implicit linking by matching email is disabled. OAuth access and refresh tokens use the authentication framework's encrypted storage. Existing provider identities must be imported before enabling new login. A user connects another provider from Account security while signed in recently. Linking requires the same verified email and retains at least one sign-in method. Provider subjects are unique across accounts. No user metadata grants administrator authority.

## Configuration

Configure values through the secure runtime environment or Worker secrets. Do not place Cloudflare credentials or account exports in this repository, browser variables, project `.env` files, chat messages, or logs. The browser needs no Supabase variables.

| Configuration                                                           | Purpose                                                                                      |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`                                                           | Random secret of at least 32 characters; use the same protected value across Worker replicas |
| `AUTH_BASE_URL`                                                         | Exact HTTPS application origin; a loopback HTTP origin is allowed only outside production    |
| `AUTH_TRUSTED_ORIGINS`                                                  | Comma-separated exact additional app origins; no wildcards                                   |
| `AUTH_EMAIL_ENABLED`                                                    | Enable only after sender onboarding and delivery validation                                  |
| `AUTH_EMAIL_FROM`                                                       | Verified sending address                                                                     |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                              | Existing Google application credentials                                                      |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                              | Existing GitHub application credentials                                                      |
| `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` | Apple Service ID, team, key ID, and protected ES256 private key                              |

The Worker uses `nodejs_compat` and the generated `AUTH_EMAIL` binding. Email delivery is awaited. The configuration keeps sending disabled until onboarding is complete. Missing auth secrets cause a recoverable 503; missing provider credentials disable that provider. Missing email delivery disables registration and recovery while configured existing-account password sign-in can continue. The public `/api/auth/config` route reveals availability only.

Provider callbacks are `/api/auth/callback/google`, `/api/auth/callback/github`, and `/api/auth/callback/apple` on the exact configured origin. The production www host redirects to the canonical host so OAuth callbacks and host-only cookies share one origin. Preserve each existing client identifier and actual provider subject. Apple needs a registered HTTPS return URL and Service ID domain association; its client secret is generated with ES256 and a one-hour expiry. A changed Apple Service ID requires a verified Apple subject transfer. Do not assume a different client has the same subject.

Static pages and assets enter the Worker first so the canonical-host redirect also applies before the application loads. The Worker then delegates canonical asset requests to `ASSETS`. Existing Smart Placement remains configured; measure page and asset latency in the intended user regions alongside password CPU time during the staging release gate, and approve the performance budget before cutover.

## Prepare a private export

1. Inspect source provider, MFA, banned, deleted, phone, anonymous, and SSO states. Resolve unsupported states without silently weakening them. Inventory counts independently of the export.
2. Freeze registration and account changes for the final export. Use a consistent read-only transaction and a D1 snapshot taken under the same freeze. An earlier rehearsal export does not authorize production import.
3. Run [the read-only export query](../../scripts/auth/export-supabase.sql) with an operator's existing secure database access. Replace its project-reference placeholder. Redirect the single JSON value using a client that omits transaction command tags, for example `psql -qAt -f`; protect the directory and file with 0700/0600 permissions. Never echo the result to a terminal or use a service-role key in browser code.
4. Export D1 into a private local SQLite snapshot through the approved Cloudflare operator procedure. The importer reads a SQLite database, not an SQL dump; restore a dump into a private SQLite file first. Finish or checkpoint any WAL before hashing the standalone snapshot. Preserve source and D1 backups with checksums.

The version-1 contract contains `source.projectRef`, `exportedAt`, `frozen`, independently checked expected user/identity counts, all users, all identities, and MFA factors. User fields include original ID, email, password hash, confirmation state, timestamps, and relevant security state. OAuth mapping uses `auth.identities.provider_id`, checked against an exported immutable subject when present. The identity row ID is never substituted for the provider subject. Confirmation is preserved exactly; unconfirmed users remain unverified.

## Validate and produce additive SQL

Use Node 24 and an explicitly designated private directory outside every Git checkout, including the parent monorepo. `AUTH_MIGRATION_PRIVATE_ROOT` is a private working boundary, not a repository root; restrict it to mode 0700. Source and snapshot must be mode 0600 files inside it. The tool checks all directory ancestors for a `.git` directory or worktree file and rejects repository paths. It never connects to either live service.

```bash
AUTH_MIGRATION_PRIVATE_ROOT=/absolute/private/migration \
  node scripts/auth/prepare-migration.mjs \
  --source /absolute/private/migration/source.json \
  --snapshot /absolute/private/migration/application.sqlite
```

This defaults to dry-run validation and prints aggregate counts and SHA-256 identities only. It rejects missing application-user coverage, duplicate normalized emails, UUID conflicts, duplicate provider subjects, unsupported providers/security states, incomplete metadata, invalid timestamps/hashes, and conflicting existing authentication rows. A failure does not emit SQL or source values.

Only after successful review, add an explicit new output destination:

```bash
AUTH_MIGRATION_PRIVATE_ROOT=/absolute/private/migration \
  node scripts/auth/prepare-migration.mjs \
  --source /absolute/private/migration/source.json \
  --snapshot /absolute/private/migration/application.sqlite \
  --output /absolute/private/migration/auth-import.sql
```

The output and adjacent receipt use 0600 permissions and exclusive creation. Existing destinations are not overwritten. All records are validated before writing. Generated SQL is additive and repeatable under the documented freeze: deterministic imported row IDs, unique provider/subject pairs, and ID-conflict skips never reassign an account. Apply schema migration `0019_application_auth.sql` first. A retry after an interrupted import must use the same validated export and unchanged source state; run dry-run again against a fresh snapshot to detect collisions before resuming. Do not treat a receipt as proof of live transfer.

## Cutover and rollback gates

Keep Supabase available and retain its data and old secrets throughout this procedure. Pushing main triggers automatic production publication in the current connected project; do not push this candidate until the whole release gate is authorized.

1. Rehearse the exact candidate commit in an isolated staging Worker and database. Restore backups; import the full private export; compare account/provider counts and all original ID joins. Verify existing history, profile privacy, settings, and representative ownership boundaries. Unsupported or uncovered accounts block release.
2. Configure the protected auth secret and existing provider credentials. Register exact staging/production callbacks. Onboard the email sender and validate confirmation/reset delivery, expiry, spam behavior, and account-enumeration responses. Measure actual Cloudflare password-hash CPU time and maximum-cost imported bcrypt verification against the configured account's limits.
3. Exercise real Google, GitHub, and Apple authorization, cancellation, invalid state, provider subject mapping, explicit linking, last-method protection, and already-owned provider rejection. Verify Apple first and subsequent authorization, private relay email, and any required subject transfer. Synthetic tests cannot replace these checks.
4. Obtain the publication authorization for the exact reviewed commit and import receipt. Freeze source registration/account/password changes briefly; take final source and D1 backups; generate and compare the final delta with rehearsal. Confirm the source count has not changed since export. Apply the additive schema and SQL; verify live row counts and owned-data joins without printing personal records.
5. Deploy the exact authorized commit/configuration, then test real verification, password sign-in/recovery, each provider, cookie expiry/renewal/revocation, learner API ownership, and administrator Access. Old Supabase sessions deliberately require sign-in again. Record exact deployment/source identities and checks. Unfreeze only after those checks pass.
6. Monitor sign-in failure, delivery failure, provider mismatch, database error, and unexpected ownership outcomes without credential-bearing logs. Any identity reassignment, inaccessible existing history, systematic provider/email failure, or failed restore check triggers rollback assessment; no automatic destructive cleanup runs.
7. For rollback, first freeze new managed registration and password/account changes. Export and reconcile managed accounts and changes created since cutover. Existing new-password hashes cannot simply be copied into Supabase; arrange a tested recovery path, provider identity reconciliation, and user communication before reverting. Preserve new managed rows and their owned data. Deploy the prior source/configuration with the retained Supabase service, verify old identity joins, then reopen safely. Never discard newly created accounts or changed credentials silently.

Production release readiness includes external delivery, real providers, Cloudflare CPU limits, full-source completeness, exact-commit hosted CI, migration rehearsal, restoration, and authorized deployment. Local preparation checks establish a source candidate, not those production outcomes.

Implementation references: [Better Auth migration](https://better-auth.com/docs/guides/supabase-migration-guide), [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [Apple provider](https://better-auth.com/docs/authentication/apple), [Cloudflare Email Service](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/), and [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
