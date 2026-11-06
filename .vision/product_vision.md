# Product vision

## The experience

Therapy Deliberate Practice Studio should feel like a focused rehearsal room. The learner sees one meaningful clinical communication problem at a time, understands the skill being practised, responds in their own words, and receives feedback that identifies observable strengths and a manageable next improvement. Recording state, model choice, and infrastructure should support this experience rather than dominate it.

The application supports English and French. Loading, empty, offline, permission-denied, model-downloading, queue-processing, and failed-evaluation states need purposeful guidance rather than context-free spinners or raw technical errors.

Accounts are owned by the application through Better Auth, backed by Cloudflare D1 in the hosted Worker and SQLite locally. The clean-start account database contains no imported Supabase identities or previous practice history. The existing exercise catalogue remains available. A learner creates a new account with verified email, or uses a social provider when its credentials are configured. Registration and recovery availability must reflect actual email delivery, and unavailable sign-in methods are omitted from the learner-facing forms. Login, signup and password recovery each have their own focused page with one primary action. Confirmation resend appears only when it is relevant. Authentication uses a compact warm-porcelain form on mobile and an adjacent geometric illustration on desktop; decorative content never pushes the mobile form down the page.

## Main product surfaces

The **library and task detail views** help learners find published tasks by skill and difficulty, inspect authors, criteria, patient examples, and interaction examples, and start practice without losing search or filter state.

The **standard practice view** presents one patient context, supports spoken or typed responses, separates transcription from evaluation, preserves recoverable work after failure, and explains whether feedback is trusted cloud evaluation or unverified local evaluation.

In standard practice, learners can optionally show a single fictional female patient in 3D alongside the existing text or audio. The visual scene does not generate dialogue or collect audio. It follows the existing prompt playback state and offers a still portrait when motion is reduced or graphics are unavailable.

The **minigame hub and live game views** provide faster free-for-all and team practice while retaining the same input, evaluation, trust, ownership, and recovery semantics. Desktop and mobile layouts are equally supported. A result must bind to the correct round and player exactly once.

The **history, profile, public profile, and leaderboard views** help learners review progress without blurring private feedback and public comparison. Public rankings use only eligible trusted data and explain exclusions clearly.

The **settings and help areas** explain cloud/local choices, privacy, retention, pairing, supported platforms, installer availability, model size and compatibility, and recovery. They must never present unsigned workflow artifacts as a public release.

The **desktop Local Runtime application** is a compact control centre. It shows whether the gateway is stopped, starting, ready, degraded, or blocked; safely manages one process; exposes a masked pairing key; identifies pending restart requirements; reports authoritative configuration/data/cache locations; and presents model load, diagnostic, and recovery states without leaking content.

The **administrator workspace** lets authorized curators manage tasks, authors, criteria, examples, interactions, translations, publication state, bulk actions, source parsing, and queued patient-audio work. Failed operations preserve editable content and never partially corrupt the published schema.

## Local inference journey

On first launch, the desktop application creates a cryptographically random capability key and starts the gateway only on loopback. The learner copies the key into web settings, where it is stored for that normalized origin and sent only as a bearer credential to the local gateway. If the key is lost or rotated, the interface provides a clear re-pairing path.

For local speech, the browser sends captured audio directly to the gateway. For local evaluation, the hosted API supplies authorized context and a schema, the browser calls the local model, and the hosted API validates and persists the returned structure as `local_unverified`. Derived scores are recomputed on the server. The same trust boundary applies to standard practice and minigames.

## Visual and interaction direction

The visual system should feel steady and humane: aubergine and midnight-blue backgrounds, warm porcelain text, apricot primary actions, lavender controls, muted gold labels and open geometric artwork, editorial headings, consistent cards and controls, clear hierarchy, and enough spacing for therapy content to breathe. A learner can see the progression from choosing a skill, through rehearsal, to reflection. Status uses words and iconography as well as colour. Primary actions are obvious, while destructive actions are separated and confirmed.

Decorative artwork may use subtle progressive scroll parallax on supported desktop browsers. It remains static for reduced motion, touch devices and unsupported browsers. Motion explains state rather than decorating delay and respects reduced-motion preferences. Responsive layouts are designed for touch and narrow screens in the same pass as desktop layouts. Long model names, translations, logs, queue states, and error messages wrap without breaking the interface.

## Quality definition

A claimed surface is ready only when its normal, empty, slow, error, recovery, keyboard, mobile, language, and privacy/trust cases have proportionate evidence. Compilation alone is not user evidence. A package is not supported until the uploaded artifact's desktop shell, sidecar, resources, gateway identity, authentication, catalog, native adapters, provenance, and shutdown behavior have been exercised on the declared target.

The product must never claim that an artifact was deployed, signed, notarized, published, or accepted by a store based only on configuration or an unexecuted workflow. It must never claim that a local model works based on a placeholder response or mocked unit test.
