# Cloud model roles

The backend selects models by workload. Learner credentials stay on the server;
request and result metadata identify the actual model used.

| Work | Model | Policy |
| --- | --- | --- |
| Ratings, rubrics, original content and clinically meaningful translation | `gpt-6.1-sol` | Extra-high reasoning; no silent evaluator downgrade |
| Ordinary translation and bounded extraction | `gpt-6-luna` | No reasoning; ambiguous clinical content escalates to Sol |
| Recorded speech | `gpt-transcribe` | File transcription with JSON output and optional language/context hints |
| Generated patient voice | `gpt-realtime-2.1-mini` | Backend-only Realtime connection, Marin voice, 24 kHz mono PCM wrapped in WAV |

`gpt-6.1-luna` is not currently exposed by the official catalogue or the configured
account's model inventory. Its requested identity is recorded separately in the
shared model contract. It is never sent as an invented API identifier, and an
available Luna model is never relabelled as that unavailable model.

Narration is bounded to 6,000 input characters, 45 seconds and 6 MiB of decoded
audio. The connection closes after one response or any failure. Incomplete audio
and a returned transcript that changes the patient wording are rejected before
caching. Existing explicitly selected Speech API models retain their adapter;
a Realtime model is never sent to `/audio/speech` and WAV data is never labelled
MP3. The UI identifies the voice as generated. This is prepared narration rather
than a live conversational agent or phoneme-aligned lip synchronization.

An optional server-provided OpenAI key is reported as an availability flag, without
returning its value. A learner can provide an encrypted personal key instead.
Removing a personal key does not remove the server's key. Use Worker secrets in
production and the ignored Worker development variables file locally. Never put
these credentials in browser variables, source files or diagnostic output.

References: [model catalogue](https://developers.openai.com/api/docs/models),
[file transcription](https://developers.openai.com/api/docs/guides/speech-to-text),
[text-to-speech migration](https://developers.openai.com/api/docs/guides/text-to-speech),
and [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations).
