# Rhymx Plugin

AI video planning + motion graphics for OpenCut, ported from the RhymxAIWebEditor project.

## What it adds

| Surface                                        | Feature                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AI panel tab**                               | Voiceover → transcription → AI scene plan (visual intent, keywords, stock-vs-motion treatment) → stock matching with approval thumbnails → one-undoable-batch apply to timeline, with optional auto-captions |
| **Motion panel tab**                           | 14 animated graphic templates rendered natively by the editor's compositor (preview and export identical). Click to insert at playhead; edit text/colors in Properties                                       |
| **`/api/rhymx/plan`, `/api/rhymx/transcribe`** | Server proxies using `GROQ_API_KEY`. When unset (HTTP 501) the client falls back to direct BYOK calls                                                                                                        |

## Keys

- **Server (optional):** set `GROQ_API_KEY` in the web app env.
- **Model overrides (optional):** `GROQ_PLANNER_MODEL` and
  `GROQ_HYPERFRAMES_MODEL`. The default is `openai/gpt-oss-120b`. If a
  configured/default model is unavailable, the client queries Groq's model
  list and retries once with an available chat model.
- **BYOK:** Groq / Pexels / Pixabay keys entered in the AI panel → "Keys" are stored in browser localStorage only.
- Keyless providers always available: Wikimedia Commons, Archive.org, NASA.

## Architecture notes

- All timeline writes go through commands (`AddTrackCommand` + `InsertElementCommand` batched in one `BatchCommand`) so undo/autosave behave.
- Motion templates are `GraphicDefinition`s registered into `graphicsRegistry` via `registerRhymxPlugin()` (called from `EditorCore`). They rely on the small renderer extension that threads `localTime`/`durationSec` into `GraphicRenderContext` when `animated: true`.
- Captions reuse OpenCut's subtitle builder (`buildSubtitleTextElement`) with word-timed cue generation (`captions/modes.ts`).
- Pure logic modules (segmentation, scoring, planner prompt/parser, keyword heuristics) have zero framework deps — candidates for a future `rust/crates/rhymx-core` extraction per AGENTS.md.
- In browser-only OpenCut, the same Groq key can generate HyperFrames scenes.
  HTML/CSS/GSAP frames are rasterized from the sandbox and encoded by the normal
  WebCodecs exporter; embedded `<video>` and `<canvas>` content still needs the
  Desktop CLI renderer.
