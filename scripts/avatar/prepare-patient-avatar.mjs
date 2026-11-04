// Run with the pinned conversion tools installed in a separate tools directory.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const [tools, sources, output] = process.argv.slice(2);
assert(
  tools && sources && output,
  "Usage: node prepare-patient-avatar.mjs <tools-directory> <source-directory> <output-directory>",
);
const require = createRequire(join(resolve(tools), "package.json"));
const { NodeIO } = require("@gltf-transform/core");
const { ALL_EXTENSIONS } = require("@gltf-transform/extensions");
const {
  meshopt,
  prune,
  textureCompress,
} = require("@gltf-transform/functions");
const { MeshoptEncoder, MeshoptDecoder } = require("meshoptimizer");
const sharp = require("sharp");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const model = await readFile(join(sources, "young-violet.glb"));
const portrait = await readFile(join(sources, "young-violet.png"));
assert.equal(
  sha(model),
  "4c372f1daf27caaede45f2cca2bb93e9d57dd90401ded0de38310ce3106d853c",
);
assert.equal(
  sha(portrait),
  "c30bb2e88c24b3a634ec8795aa2b512cca9cb4ab85f0b1c88938390e9aa54245",
);
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.encoder": MeshoptEncoder,
    "meshopt.decoder": MeshoptDecoder,
  });
const document = await io.readBinary(model);
const root = document.getRoot();
const supported = new Set(["jawOpen", "eyeBlinkLeft", "eyeBlinkRight"]);
for (const mesh of root.listMeshes()) {
  const names = mesh.getExtras().targetNames;
  if (!Array.isArray(names)) continue;
  const keep = names.flatMap((name, index) =>
    supported.has(name) ? [index] : [],
  );
  for (const primitive of mesh.listPrimitives()) {
    const targets = primitive.listTargets();
    assert.equal(targets.length, names.length);
    targets.forEach((target, index) => {
      if (!keep.includes(index)) target.dispose();
    });
  }
  mesh.setExtras(keep.length ? { targetNames: keep.map((i) => names[i]) } : {});
  mesh.setWeights(keep.map((i) => mesh.getWeights()[i] ?? 0));
  for (const node of root
    .listNodes()
    .filter((node) => node.getMesh() === mesh)) {
    if (node.getWeights().length)
      node.setWeights(keep.map((i) => node.getWeights()[i] ?? 0));
  }
}
await document.transform(
  prune({ keepAttributes: true }),
  textureCompress({
    encoder: sharp,
    targetFormat: "webp",
    resize: [1024, 1024],
    quality: 88,
  }),
  meshopt({
    encoder: MeshoptEncoder,
    level: "medium",
    quantizePosition: 16,
    quantizeTexcoord: 14,
  }),
);
const bytes = await io.writeBinary(document);
const primitives = root.listMeshes().flatMap((m) => m.listPrimitives());
const triangles = primitives.reduce(
  (n, p) =>
    n +
    (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3,
  0,
);
const fallback = await sharp(portrait)
  .resize({ width: 600, withoutEnlargement: true })
  .webp({ quality: 86 })
  .toBuffer();
const retainedMorphs = [
  ...new Set(root.listMeshes().flatMap((m) => m.getExtras().targetNames ?? [])),
].sort();
assert.deepEqual(retainedMorphs, [...supported].sort());
assert(
  bytes.length <= 2 * 1024 * 1024 &&
    triangles <= 35000 &&
    primitives.length <= 12 &&
    fallback.length <= 80000,
);
await mkdir(output, { recursive: true });
await writeFile(join(output, "patient-violet.glb"), bytes);
await writeFile(join(output, "patient-violet.webp"), fallback);
console.log(
  JSON.stringify(
    {
      sourceBytes: model.length,
      bytes: bytes.length,
      triangles,
      primitives: primitives.length,
      retainedMorphs,
      sha256: sha(bytes),
      fallbackBytes: fallback.length,
      fallbackSHA256: sha(fallback),
    },
    null,
    2,
  ),
);
