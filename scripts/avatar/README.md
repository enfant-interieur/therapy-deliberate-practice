# Preparing the optional patient avatar

The application serves `patient-violet.glb` and `patient-violet.webp` from its own
origin. The 3D runtime loads only when a learner enables the patient view. The
existing prompt audio drives the visual speaking state; this is gentle speech
accompaniment, without phoneme alignment or a separate audio stream.

The input files are the `young-violet.glb` and `young-violet.png` exports from the
Avatar studio's generated gallery. The conversion checks their exact hashes.
Prepare the output with Node.js 24 and a separate tool installation containing
`@gltf-transform/core@4.3.0`, `@gltf-transform/functions@4.3.0`,
`@gltf-transform/extensions@4.5.1`, `meshoptimizer@1.3.0` and `sharp@0.35.5`:

```sh
node scripts/avatar/prepare-patient-avatar.mjs <tools-directory> <source-directory> <output-directory>
```

The source model is 9,993,496 bytes. The prepared model is 722,256 bytes, with
28,264 triangles, eight primitives and the jaw and two eyelid morphs. The
portrait fallback is 52,062 bytes. The model SHA-256 is
`932d9872aa8c8c7d64f45cf400d24b08f51ea224390a9e7de0b320c33c4fc116`.
Asset attribution is in `apps/web/public/avatars/ATTRIBUTION.txt`.
