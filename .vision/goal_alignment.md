# Goal alignment

## Executive summary

Therapy Deliberate Practice Studio helps psychotherapy trainees and clinicians rehearse specific communication skills, receive structured feedback, and observe progress over time. It is an educational training product, not a diagnostic tool and not a replacement for supervision. The central product promise is that a learner can move from choosing a skill to completing a realistic spoken or typed response and understanding the feedback without having to understand the application's infrastructure.

The product supports two artificial-intelligence paths. Cloud mode uses a server-side provider. Local mode uses a separately installed desktop application and a loopback gateway on the learner's own computer. Local speech and language-model content must travel directly between the browser and that gateway; the hosted Cloudflare Worker cannot reach a user's `127.0.0.1`. Cloud services may prepare authenticated task context and persist a learner's locally produced result, but locally produced evaluations must be visibly marked as unverified and excluded from public comparisons.

## People, outcomes, and concepts

The primary user is a psychotherapy trainee or clinician who wants focused practice with a skill such as reflection, validation, or handling a difficult interaction. A successful session lets the learner understand the prompt, respond in their own words, receive criterion-level feedback, and choose a manageable next improvement. Educators and administrators curate tasks, criteria, examples, interactions, difficulty, translations, authorship, and publication state without weakening learner privacy or evidence boundaries.

A **task** is a deliberate-practice exercise with a title, description, skill domain, difficulty, criteria, authors, and patient or interaction examples. A **practice session** is an ordered set of task examples undertaken by one authenticated learner. An **attempt** is the learner's response, transcript, criterion-level evaluation, overall result, model provenance, and trust provenance. A **minigame session** is a faster solo or group practice format that retains the same authoritative evaluation and trust semantics.

A **model catalog entry** is an executable contract. It identifies a real adapter, immutable model revision, supported platforms, endpoint, hardware guidance, and approximate download size. `cloud_trusted` evaluations are produced and validated through the authenticated server path. `local_unverified` evaluations are supplied by the learner's browser after local inference and may guide private learning, but cannot support public or cross-user comparative claims.

## Binding product priorities

1. Standard practice and minigames must be calm, legible, responsive on desktop and mobile, and explicit about input, recording, transcription, evaluation, progress, errors, and recovery.
2. Local inference must use a browser-to-loopback connection protected by a per-install capability key. The key must never be sent to the hosted API, placed in a URL, logged, or included in analytics.
3. Therapy-related prompts, transcripts, and model outputs are sensitive. Ordinary logs and diagnostics remain metadata-only.
4. Server-derived totals, authenticated task identity, schema validation, ownership, publication state, and trust provenance are authoritative.
5. Accessibility, keyboard operation, touch targets, visible focus, reduced motion, readable contrast, meaningful status text, and error recovery are part of correctness.
6. A model, operating system, installer, or release claim is supported only when proportionate executable evidence exists. Build-only validation is distinct from deployment or publication.
7. Production-only features already present in the authoritative `enfant-interieur` lineage, including authorship, interaction editing, bulk administration, queued parsing and patient-audio work, and current Cloudflare bindings, must be preserved while validated donor improvements are integrated.

## Current and canonical stack

The authoritative production lineage currently resolves React 18.3.1, React Router 6.30.3, TypeScript 5.9.3, Vite 5.4.21, Redux Toolkit 2.11.2, Zod 3.25.76, PixiJS 8.14.3, Supabase 2.89.0, Vitest 2.1.9, Playwright 1.57.0, Hono 4.11.1, and Drizzle ORM 0.33.0. Its local gateway declares Python 3.10 or newer, PyTorch 2.6.0, and unpinned broad Python dependencies; its desktop package is version 0.1.0 on Tauri 2 and Rust 2021.

The canonical integrated target uses Node.js 24 LTS and npm 11; React 19.2.8; React Router 7.18.1; TypeScript 6.0.3; Vite 8.1.5; Redux Toolkit 2.12; Zod 4.4.3; PixiJS 8.19; Supabase 2.110.8; Vitest 4.1.10; current Playwright; Hono 4.12.32; and Drizzle ORM 0.45.2. The local gateway uses the pinned Python 3.12.13 standalone runtime, FastAPI, Uvicorn, Pydantic 2, PyTorch 2.13, Transformers 5.14.1, MLX on Apple silicon, Faster Whisper 1.2.1, and Parakeet MLX 0.5.2. The desktop launcher uses Tauri 2, stable Rust 2021, React 19.2.8, Vite 8.1.5, and a packaged target-specific Python sidecar.

The target stack is not considered integrated merely because it exists in a donor repository. It becomes the authoritative stack only after production-only behavior is reconciled, the combined source passes the complete user-story matrix, and the resulting commit advances production `main` by fast-forward.

## Architectural and release boundaries

The browser owns presentation, microphone capture, explicit local pairing, and direct calls to the loopback gateway. The hosted API owns authentication, task and criterion data, authorization, source parsing, evaluation-context preparation, returned-structure validation, server-derived aggregates, persistence, and trust labeling. The desktop launcher owns one gateway process, atomic configuration, capability rotation, authoritative data/cache paths, model defaults, metadata-only logs, and diagnostics. The model registry owns per-model lifecycle synchronization.

The production web application runs as a Cloudflare Worker with D1, R2, Queues, static assets, and Supabase authentication. Local development may use Node and SQLite adapters. Normal continuous integration and unsigned native builds cannot deploy the Worker, mutate Cloudflare, sign packages, create tags, notarize software, publish a GitHub Release, or submit to a store. Those operations require explicit authorization and executed evidence.

