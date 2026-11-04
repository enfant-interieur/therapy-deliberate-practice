# Product requirements

## Purpose and scope

Therapy Deliberate Practice Studio must support published-task discovery, spoken or typed attempts, structured evaluation, progress review, minigames, administration, and an optional on-device inference path. These requirements govern product behavior and evidence. They do not by themselves authorize deployment, release publication, tags, signing, notarization, Cloudflare mutations, or store submission.

## Learner practice and evaluation

Authenticated learners must be able to find and open published tasks, understand their criteria and examples, record or type a response, inspect the transcript, request evaluation, and review criterion-level feedback. Recording, upload, transcription, evaluation, and persistence are separate visible states. Retrying a failed later phase must not needlessly discard successful earlier work.

The optional 3D patient view must make no model or renderer requests before explicit opt-in. The single same-origin character is limited to 2 MiB and 35,000 triangles, with a portrait fallback for reduced motion or graphics failure. Visible speech accompaniment is capped at 30 frames per second with no continuous drawing while idle or offscreen. Existing text, playback, recording and evaluation remain independently usable.

The server must validate user, task, example, session, publication, and ownership relationships before persistence. Cloud evaluation uses GPT-6.1 Sol with extra-high reasoning. Ordinary formatting and bounded extraction use GPT-6 Luna. Clinically meaningful translations require Sol. Requests have explicit output budgets and timeouts, reject refused or incomplete output, and preserve recoverable work when a provider fails. Evaluator output must match the expected schema, and overall totals must be recomputed from accepted criterion values. Persisted attempts must record provider/model identity and either `cloud_trusted` or `local_unverified` provenance.

Personal history and adaptive practice may use visibly labeled local-unverified results. Public leaderboards, cross-user rankings, trusted comparative statistics, and claims about evaluator equivalence must exclude local-unverified and ambiguously classified legacy results.

## Authentication

Learner login is managed by Better Auth in the application backend with D1 in production and SQLite locally. Google, GitHub, Apple and verified email/password sign-in are supported when their delivery and provider credentials are configured. Registration, confirmation resend, complete password reset, persistent sessions, sign-out, password change and revocation of other sessions must have recoverable English/French interfaces. Authentication uses server-validated HttpOnly cookies, durable rate limiting and origin protection for cookie-authenticated mutations. OAuth access and refresh token storage is encrypted; implicit email-based account linking is disabled. Sensitive account changes require fresh verified authentication. Administrator authorization remains Cloudflare Access.

Account migration must retain the original user identifiers and application-owned data. Export validation rejects identity collisions and unsupported security states before generating private import artifacts. Live transfer requires verified backups, provider subjects, email delivery, account reconciliation and a tested cutover/rollback procedure. Old sessions require reauthentication. Preparation does not authorize live migration or publication.

## Sessions, profiles, and administration

Practice and minigame sessions must restore partial progress safely, handle stale or corrupt state without trapping the learner, reject cross-user access, prevent duplicate completion, preserve recoverable drafts after failures, and delete only the selected owned session after confirmation.

Users must be able to update their own profile with validation and recoverable failure behavior. Public profiles must expose only intended public information.

Authorized administrators must be able to create, parse, import, edit, translate, duplicate, reorder, publish, bulk-manage, and delete tasks, authors, criteria, patient examples, and interaction examples. Production queue-based parsing and patient-audio generation must remain non-blocking and observable. Source parsing must reject forbidden destinations and redirects, enforce bounded time and bytes, validate content type, and preserve editable work after failure. Non-administrators must be rejected by the server.

## Local Runtime Suite and models

The desktop application must start and stop exactly one owned gateway, distinguish it from a foreign listener, use one atomic durable configuration, and show truthful gateway, model, restart, storage, cache, and diagnostic states. The gateway must bind to loopback by default and enforce capability, Origin, and Host policies. Health must expose stable product identity without leaking the capability or therapy content.

The capability key must be masked by default, explicitly revealable and copyable, and atomically replaceable after confirmation. The browser stores it only for the normalized loopback origin and never sends it to the hosted API, query strings, logs, telemetry, or error reporting.

Every generated model-catalog entry must map to a real implementation with immutable default revision, accurate platform/backend support, endpoint, memory guidance, and approximate size. Model lifecycle operations must be synchronized per model. Gateway health and catalog access must not wait for model downloads. Prompts, transcripts, and outputs must remain absent from ordinary and diagnostic logs.

## Usability, accessibility, and language

The application supports English and French. Audited user-facing strings must come from locale resources, preserve state across language changes, and remain readable with long translations. Normal, loading or slow, empty, failure, recovery, keyboard/focus, 360-pixel mobile, 768-pixel intermediate, and 1100-pixel desktop behavior must have proportionate evidence across major routed and native surfaces.

Controls need accessible names, visible focus, touch-friendly targets, status that is not conveyed by colour alone, and reduced-motion behavior for animation-heavy states. Long operations require honest phase information and cancellation or safe retry only where the underlying operation supports it.

## Packaging, deployment, and publication

Portable Python sidecars must use pinned upstream artifacts and verified checksums. Target selection must be exact, archives extracted safely, cache identity bound to all relevant inputs, and executables named for Tauri's target convention. Native packages must be installed or extracted safely and exercise the packaged desktop shell, gateway startup/authentication/shutdown, catalog, provenance, and required real backend-family smokes.

Normal continuous integration and unsigned build workflows use read-only permissions and cannot publish a release. Deployment to Cloudflare must use the authoritative `enfant-interieur/therapy-deliberate-practice` fast-forward `main` only after the integrated commit passes all required gates and deployment is explicitly authorized. Desktop publication remains separate and requires protected environments, credentials, signing/notarization evidence, checksums, attestations, and explicit publication authorization.

## Acceptance evidence

Completion requires:

- Node 24 lint, strict type checks, unit/integration tests, production builds, and production-reachability dependency audit;
- routed browser tests covering all learner, account, help, administrator, standard-practice, minigame, trust, privacy, failure, recovery, keyboard, language, and responsive story groups;
- Python 3.12 lock validation, Ruff, deterministic gateway/model/security tests, generated catalog checks, and bounded real library-path integration evidence;
- Rust formatting, Clippy/check, unit tests, and desktop interface tests;
- workflow syntax and permission review, release metadata checks, exact-commit continuous integration, and required unsigned native target receipts;
- direct evidence that validated improvements and production-only behavior coexist without regression;
- structured independent review with no unresolved Critical or High finding.

Small fixture models prove backend integration, not full production-checkpoint output quality. A support or publication claim remains limited when its native, credential, hardware, or protected-environment evidence is unavailable.

## Finite score boundary

Port implementation, all-user-story testing, technical readiness, product quality, and code-publication readiness reach 100 only when every applicable checklist item above has direct evidence and no unresolved Critical or High finding. The scores summarize finite evidence coverage; they are not a claim of universal perfection.
