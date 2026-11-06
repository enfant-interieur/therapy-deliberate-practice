# Application-owned accounts and a clean start

Therapy Studio manages accounts with Better Auth, Cloudflare D1 and secure server cookies. Local development uses the same service with SQLite. The browser does not use a Supabase SDK, configuration or session. The new account database is independent of the former Supabase service.

The clean-start database receives only `tasks`, `task_criteria`, `task_examples` and `task_interaction_examples` from the existing application catalogue. These records retain their identifiers, parent relationships, authorship and publication state. Users, passwords, provider identities, sessions, settings, attempts, progress, game history, jobs and cached audio are not copied. Existing users create new accounts. Former databases, audio storage, queues and Worker versions remain separate rollback resources; a clean start does not delete them.

## Configure sign-in

Set a cryptographically random `AUTH_SECRET` of at least 32 characters as a Worker secret. `AUTH_BASE_URL` is the exact canonical HTTPS application origin. `AUTH_TRUSTED_ORIGINS` contains only explicitly supported origins. Keep secrets outside Git, browser configuration and logs.

Email/password registration requires confirmation. Configure the `AUTH_EMAIL` send binding and `AUTH_EMAIL_FROM` with the onboarded sender. Set `AUTH_EMAIL_ENABLED=true` only after real confirmation and recovery delivery have been tested. With email disabled, new registration, confirmation resend and password recovery are unavailable. Verification is never bypassed to accommodate a missing sender. Verification links expire after one hour; password-reset tokens expire after fifteen minutes and a completed reset revokes previous sessions.

Google requires `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; GitHub requires `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`. Apple requires `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` and `APPLE_PRIVATE_KEY`. Register `/api/auth/callback/google`, `/api/auth/callback/github` and `/api/auth/callback/apple` on the canonical origin with the respective provider. Missing credentials disable that provider. Configuration is distinct from verification of an actual provider authorization flow; do not advertise an untested provider as working.

New passwords use PBKDF2-HMAC-SHA-256 with 600,000 iterations, a random 16-byte salt and a 32-byte derived key. Cookies are Secure, HttpOnly and SameSite=Lax in production. Sensitive account changes require a recent verified sign-in. Provider linking is explicit, and signing out revokes the server session. The [authentication contract](migration.md) describes the remaining security settings.

## Publish the exact validated source

Run the relevant local checks and inspect the intended changes before pushing `main` to the authoritative repository. The Cloudflare build gate verifies the successful `ci.yml` push run for that exact commit and checks that it is still remote `main`. A missing, pending, failed, cancelled, unverifiable or timed-out run cannot authorize deployment. The check waits for at most ten minutes and fails closed. GitHub test builds skip the deployment gate so the workflow does not wait for itself.

The gate is configured in Wrangler's custom deployment build and the root and web npm prebuild scripts. Cloudflare's dashboard build configuration is separate from Wrangler's custom build settings. Validate the installed Wrangler deployment hook before relying on it. If an integration changes its command to bypass these entry points, configure an enforced gate in the new command before automatic publication.

Automatic publication also checks that the production Worker already has its protected `AUTH_SECRET` binding. The first clean-start deployment installs that secret together with the new code and database through a guarded manual deployment. The automatic build fails closed until this bootstrap is complete; subsequent deployments inherit the secret. Missing Cloudflare metadata access cannot bypass this check.

Before cutover, verify the new database's catalogue counts and content hashes, foreign keys and empty account/history/job tables. Record the old queue backlog and retention, and pause legacy queue delivery without purging messages. Pausing does not suspend the message-expiry clock. New requests must use the new queues and audio bucket. Keep administrator Cloudflare Access and the server API key configured.

After publication, verify the actual Worker version and resource bindings, public catalogue, canonical-host redirect, login availability, protected personal APIs, registration and recovery, and each configured social provider. A successful push is distinct from a successful deployment. Report missing delivery or provider configuration accurately.

For a guarded manual deployment after CI, set `THERAPY_RELEASE_CHECK_CI=1` and `THERAPY_RELEASE_COMMIT` to the reviewed full commit hash when invoking Wrangler. The same gate verifies the current main commit and its CI result. An optional `GH_TOKEN` or `GITHUB_TOKEN` can authenticate metadata requests; it is never logged or included in the Worker bundle.

Before reverting after any new registration, preserve and reconcile the new accounts, password changes and owned records. Deploying the former Worker must not silently discard people who joined after the clean start. Restore queue configuration deliberately and retain both generations of data until reconciliation is complete.
