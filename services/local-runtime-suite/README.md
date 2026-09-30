# Therapy Local Runtime

Run language models and speech transcription on your computer, then connect them to Therapy Deliberate Practice. The desktop application manages the local server, model files, memory, and pairing. Version 0.1.8 adds a model workspace with two optional profiles, resource guidance, cache discovery, individual loading and memory release, and preparation cancellation.

Local feedback is educational and remains `local_unverified`. It can guide private practice. It does not establish clinical validity or eligibility for public comparisons.

## Get started

1. Open the desktop application and start the local server. Its normal address is `http://127.0.0.1:8484`. The application checks product identity before using an existing listener.
2. Choose a profile or adjust the language and transcription selections. Model cards show the actual pinned files present on this computer, download size, memory guidance, and whether weights are loaded. Choosing a profile does not download it.
3. Prepare the selected models. Existing complete Hugging Face snapshots are reused. A model can also be loaded or released individually from its card. Releasing memory preserves its files and your settings.
4. Copy the local address and masked pairing key into the separate fields in Therapy Settings. The key is revealed or copied only through an explicit action. Rotating it requires confirmation and requires pairing again.
5. Save your chosen defaults. They can be saved before weights load. On Intel Mac, the supported configuration contains transcription only.

The interface is available in English and French. The computer needs a desktop operating system; the native server is not an iPhone or mobile-browser runtime.

## Choose a model profile

The profiles below were inspected on 30 September 2026. Download sizes count the runtime files in the immutable asset manifest, in decimal GB. Memory guidance uses GiB and includes headroom beyond the model files. Actual memory depends on input length, output length, other applications, and the backend.

| Profile or model | Intended use | Runtime files | Memory guidance | Backend and platform |
| --- | --- | ---: | ---: | --- |
| Compact practice: Qwen3.5 2B + Whisper base | Short French/English training responses and transcription | 1.90 GB combined | At least 8 GiB; 16 GiB preferred when other applications are open | MLX language model on Apple Silicon; Whisper on CPU |
| Detailed feedback: Qwen3.5 9B + Parakeet v3 | More detailed French/English training feedback and transcription | 8.49 GB combined | At least 16 GiB; 24 GiB preferred for headroom | MLX on Apple Silicon |
| Existing Qwen3 4B MLX + Whisper base | A useful existing configuration, retained without migration or deletion | 2.43 GB combined | At least 8 GiB | Apple Silicon |
| Qwen3 4B Transformers + Whisper base | Language and speech on Windows/Linux, with optional Apple Silicon Transformers | 8.21 GB combined | At least 16 GiB; CPU latency depends heavily on hardware | Transformers; CPU by default on Windows/Linux |
| Whisper base alone | French/English transcription on Intel Mac | 0.148 GB | At least 6 GiB | CPU; macOS 14 or later |

The compact checkpoint can miss detailed instructions. In one synthetic French example, it produced empathetic wording but omitted the requested open question. The 9B checkpoint followed that instruction in the same example. These are small integration examples, not a benchmark of treatment efficacy or reliable assessment equivalence. Inspect feedback and retain normal educational supervision.

The gateway currently delivers **transcription**, not local speech synthesis. The speech synthesis endpoint reports unsupported functionality; the catalog does not advertise a placeholder voice model. Parakeet v3 supports French and English through its multilingual upstream model. Whisper base is multilingual; CPU execution keeps it usable across all four desktop targets.

## Exact model identities and licenses

| Model ID | Upstream repository and immutable revision | License |
| --- | --- | --- |
| `local//llm/qwen35-2b-mlx` | [Qwen3.5 2B 4bit](https://huggingface.co/mlx-community/Qwen3.5-2B-4bit/tree/674aaa7240b91e8012fcad5d791b7dfe5ba90207) | Apache-2.0 |
| `local//llm/qwen35-9b-mlx` | [Qwen3.5 9B 4bit](https://huggingface.co/mlx-community/Qwen3.5-9B-4bit/tree/8b2b98c00a6b4d291155e4890773ca8f769aee53) | Apache-2.0 |
| `local//llm/qwen3-mlx` | [Qwen3 4B Instruct 2507 4bit](https://huggingface.co/mlx-community/Qwen3-4B-Instruct-2507-4bit/tree/50d427756c6b1b2fe0c0a10f67fbda1fc8e82c1b) | Apache-2.0 |
| `local//llm/qwen3-hf` | [Qwen3 4B Instruct 2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/tree/cdbee75f17c01a7cc42f958dc650907174af0554) | Apache-2.0 |
| `local//stt/faster-whisper` | [Faster Whisper base](https://huggingface.co/Systran/faster-whisper-base/tree/ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66) | MIT |
| `local//stt/parakeet-mlx` | [Parakeet TDT 0.6B v3 MLX](https://huggingface.co/mlx-community/parakeet-tdt-0.6b-v3/tree/ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15) | CC-BY-4.0; retain upstream attribution |

`python/local_runtime/catalog-assets.json` records selected filenames, exact sizes, immutable revisions, source URLs, and available upstream large-file SHA-256 values. Cache completeness checks use the required runtime files and their exact sizes. They do not require README or repository administration files, and they do not claim to rehash every cached weight on every refresh. The Hub verifies downloaded artifacts through its normal cache mechanism; actual model load and inference provide additional compatibility evidence.

Qwen3.5 is used through the text-only implementation already included in pinned `mlx-lm` 0.31.3. The application does not expose its image/video inputs. Both language adapters preserve message roles and instructions, apply the tokenizer's chat template, and disable optional thinking for bounded practice responses.

## Downloads, memory and recovery

The displayed byte progress counts **completed files**. An in-progress weight file may be large, so that number can remain unchanged while data is transferring. The next phase is loading into memory. The interface does not invent a continuous transfer percentage.

Cancel preparation to stop before the next file or model load. A transfer already in progress finishes its current file; a load already running finishes safely. Completed and partial files are retained. Cancellation of a shared load may also stop a request waiting for that same preparation. Retry uses the retained files. Inference cancellation remains a separate request operation.

A model cannot be released while its shared load or active inference is running. The gateway also checks the backend lock, because a cancelled request may still be finishing inside a native library. Retry release once the operation finishes. Unloading never deletes a cache.

If preparation fails, inspect free storage, network availability, and the platform requirements, then retry. The app returns a bounded recovery message rather than backend exception content. If another service occupies the selected port, choose another port in advanced settings. The application only stops its own managed process. Port changes show the resulting restart behavior and preserve recoverable settings after failure.

## Privacy and data flow

The browser sends audio and language-model requests directly to the loopback gateway. A hosted Worker cannot reach the user's localhost. Therapy may supply authenticated task context and save a private locally produced result; the result keeps its unverified provenance.

Every protected route requires the per-install capability key in an authorization header, including inventory, load, cancellation, unload, settings, logs, and detailed health. Origin and Host checks remain enforced. The application never puts the key into a URL or sends it to the hosted API. Ordinary logs and diagnostic views contain operational metadata. Backend exception messages and traces are excluded because they can contain user content.

Advanced settings show authoritative configuration, data, and cache locations. Defaults use `.therapy/local-runtime` for direct gateway development and the native application's resolved configuration directory for packaged use. Existing complete snapshots in the standard Hugging Face cache can be reused without copying weights. New downloads go to the configured cache. Environment overrides used for developer fixtures remain supported; they are distinct from the catalog's pinned production checkpoint identity.

## Platform and package evidence

Real full-checkpoint language and synthetic French/English transcription were exercised on Apple M1 Max with 64 GiB memory, using the packaged Python 3.12.13 dependencies. Qwen3.5 2B, Qwen3.5 9B, Qwen3 4B MLX, Whisper base and Parakeet produced real outputs. Windows/Linux language models and Intel Mac transcription retain their configured native workflows; those targets were not executed on this Mac.

Native workflows distinguish an unsigned build artifact from a published, signed and notarized release. Version 0.1.8 is a local packaging candidate until the relevant target receipts and protected publication steps exist. See [desktop build and release instructions](desktop/README.md). Do not treat a configured workflow or a mocked test as evidence that a target package or model works.
