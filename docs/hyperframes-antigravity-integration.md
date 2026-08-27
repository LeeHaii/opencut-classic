# Implementation Plan — HyperFrames + HyperFrames Studio + Antigravity CLI in OpenCut

Status: Draft v1 · Date: 2026-08-23
Decisions locked: **Tauri v2 desktop shell** (native runtime) + **native `hyperframes` timeline element type**.

---

## 1. Executive Summary

We integrate three upstream technologies into OpenCut:

| Piece | What it is | Role in OpenCut |
|---|---|---|
| **HyperFrames** (engine + CLI + `@hyperframes/player`) | HTML/CSS + `data-*` attributes → deterministic MP4 via headless Chrome + FFmpeg. Apache-2.0. | Authoring format for AI-generated motion scenes; local render engine; sandboxable preview player |
| **HyperFrames Studio** (`hyperframes preview` server + web UI) | Browser-based composition editor served by the CLI | Power-user manual editing window for a composition, synced live to the timeline element |
| **Antigravity CLI** (`agy`, Google, ≥1.1.7) | Headless coding-agent CLI (`--print --output-format stream-json`), owns OAuth in OS keychain | The agent that turns chat requests into self-contained HyperFrames HTML |

The reference implementation is **Gravity Frames Studio** (`E:\CodingFolder\hyperframes-antigravity-integration`), an Electron app that proves the whole loop. We port its proven contracts (CLI invocation, sandboxing, prompt template, master/child composition management) onto OpenCut's different architecture: a Next.js UI shell driven through a **Tauri v2** Rust core, with compositions becoming a **first-class timeline element type** rendered through OpenCut's existing WASM compositor + mediabunny/WebCodecs export.

End state: user drops an "AI Scene" element on the timeline, chats with Antigravity, the generated HTML plays in sync in the preview, optionally gets hand-polished in Studio, renders to MP4 via the bundled HyperFrames CLI, and exports inside the normal OpenCut project pipeline.

---

## 2. Analysis Summary (inputs)

### 2.1 Gravity Frames Studio — proven contracts worth porting

Verified against source (`src/main/services/*`, `src/renderer/components/*`):

1. **Antigravity invocation** (`src/main/services/antigravity.ts:306`)
   ```
   agy --dangerously-skip-permissions --print <prompt>
       --output-format stream-json --print-timeout 20m
       [--conversation <id>] [--model <name>]
   ```
   - Spawned **without shell**, `windowsHide: true`; cwd = per-project agent workspace.
   - Env: clone of parent env with `AGY_CLI_HIDE_ACCOUNT_INFO` deleted (so account email/plan appear in output).
   - Version gate ≥ 1.1.7; executable resolved via `ANTIGRAVITY_CLI_PATH` → `%LOCALAPPDATA%\agy\bin\agy.exe` (win) / `~/.local/bin/agy` (posix) → PATH lookup.
   - Login: spawn interactive CLI detached (`child.unref()`), user completes Google Sign-In in its own terminal; app never sees tokens.
   - stream-json parsing: newline-delimited JSON events; scrape `conversation_id`/`session_id` (recursive key search), `usage` object, final text from keys matching `/^(text|content|result|response|output)$/i` preferring `result|final` typed events, else concatenated deltas, else plain lines.
   - Guards: duplicate-request rejection, 120,000-char prompt cap, 20-min watchdog, live stdout/stderr forwarding, cancel = kill child.
   - Account email/plan scraped recursively from JSON or banner text; cached.

2. **Prompt template** (`src/renderer/components/AntigravityChat.tsx:155`) — constrained authoring brief requiring: one ```` ```html ```` fence, single root `id=<compositionId>` with `data-composition-id/data-start="0"/data-duration/data-width/data-height`, no root `data-track-index`, all timed visuals `class="clip"` + `data-start/data-duration/data-track-index` + stable ids, **deterministic seekable animation** (paused GSAP timeline registered at `window.__timelines[compositionId]`; no setTimeout/Date/random/wall-clock CSS), no network APIs/storage/Electron, CDN script tags allowed, one-sentence summary before the fence. Includes recent chat turns (last 6), up to 4 reference image paths, and a fresh **seed document** (standalone HTML with empty GSAP timeline + media layers).

3. **Sandboxing + preview bridge** (`HyperframesScenePlayer.tsx`, `services/hyperframesPreview.ts`)
   - `<hyperframes-player>` web component from `@hyperframes/player`; on every HTML change: `player.iframeElement.sandbox.remove('allow-same-origin')` then `setAttribute('srcdoc', prepared)`.
   - Because same-origin DOM access is gone, an injected ~150-line **preview bridge** script duplicates minimal HyperFrames semantics inside the srcdoc: discovers `window.__timelines[id]`, computes duration from root `data-duration` (else timeline duration), toggles visibility of `[data-start]` elements, syncs `<video>.currentTime`, and answers parent postMessage `{source:'hf-parent', type:'control', action:'play'|'pause'|'seek'|'set-playback-rate'}` (seek accepts seconds or `frame/30`), posting back `ready/state/play/pause/ended/error`.
   - External GSAP `<script src>` tags are stripped and **bundled GSAP is inlined** (`gsap/dist/gsap.min.js?raw`) so preview works offline and deterministically.
   - Stored source HTML is never modified.

4. **Master/child composition management** (`services/hyperframesStudio.ts`)
   - Each chat turn produces a **child composition** written to `compositions/NNN-chat-<slug>.html`; a **master** host document (`index.html`, marker `data-gravity-frames-master="1"`) appends host divs sequentially and extends its own `data-duration`.
   - Children are normalized on append: ids/composition-id renamed, root forced `data-start=0`, root `data-track-index` stripped, layer ids uniquified.
   - Studio lifecycle: spawn `node cli preview <dir> --port N --force-new --no-open --no-proxy`, detect URL on stdout (25 s budget), single active instance, tree-kill on close; HTML round-trip via 1 s polling read + writes through Studio's HTTP API (`GET/PUT /api/projects/<name>/files/<path>` with `If-Match`). (For OpenCut v1 we simplify: direct file writes + Studio's live reload; polling read unchanged.)

5. **Render + attach** (`services/hyperframes.ts`)
   - Composition written to isolated dir `<renderDir>/.gravity-frames/clips/<projectId>/hyperframes/<sceneId>/index.html`; app-only media protocol URLs rewritten back to `file:` **only inside that directory**; nested `data-composition-src` children satisfied by copying the Studio project dir alongside.
   - Spawn: `spawn(process.execPath, [cliPath, 'render', '-o', outMp4], { ELECTRON_RUN_AS_NODE: '1' })` — Electron-as-Node trick. **OpenCut/Tauri cannot reuse this** (no bundled Node); see §4.3 for the Node-detection decision.
   - 30-min timeout, streamed progress, MP4 path returned after existence check; the MP4 replaces the scene's media and flows into the normal Remotion/FFmpeg export. Audio rides along (producer mixes composition audio into the MP4).

### 2.2 OpenCut-classic — integration surface

- **UI shell**: `apps/web` Next.js 16 App Router; editor page `apps/web/src/app/editor/[project_id]/page.tsx` = ResizablePanelGroup(AssetsPanel / PreviewPanel / PropertiesPanel / Timeline).
- **State**: `EditorCore` singleton (`apps/web/src/core/index.ts`) with manager objects (timeline/playback/scenes/project/media/renderer/save/audio/selection/command) + small zustand stores for UI-only state. `useEditor(selector)` via `useSyncExternalStore`.
- **Timeline model** (`apps/web/src/timeline/types.ts`): `TScene.tracks = { overlay[], main: VideoTrack, audio[] }`; elements extend `BaseTimelineElement { id, duration/startTime/trimStart/trimEnd: MediaTime, animations, params }` — `VideoElement | ImageElement | TextElement | StickerElement | GraphicElement | EffectElement`. Time = integer ticks (`MediaTime` from `rust/crates/time`, re-exported via wasm).
- **Render**: `buildScene()` (`services/renderer/scene-builder.ts`) maps element types → node classes; `resolve.ts` resolves nodes to textures; `compositor/frame-descriptor.ts` emits `FrameItemDescriptor`s into the WASM wgpu compositor. Texture uploads have a **`"rendered"` kind: `{ draw(ctx), contentHash }` drawn into OffscreenCanvas and hash-cached** — the exact seam for poster/static frames of an HTML composition.
- **Export**: 100% client-side — `renderer-manager.exportProject()` → audio mix (`mediabunny` AudioBufferSink) → `SceneExporter` (mediabunny Output + Mp4OutputFormat, CanvasSource avc/vp9) → download buffer. **No server, no FFmpeg.** An externally-rendered MP4 slots in as a plain video `MediaAsset` (`ephemeral: true` supported).
- **No AI/chat infra, no iframe/HTML composition anywhere today.** Local Whisper transcription exists (`services/transcription/`) as the closest "heavy local model" precedent.
- **Adding an element type fans out to ~10 sites**: `timeline/types.ts`, `placement/compatibility.ts` (`ELEMENT_TRACK_MAP`), `commands/timeline/element/insert-element.ts`, `timeline/element-utils.ts`, `scene-builder.ts`, `nodes/*`, `resolve.ts`, `frame-descriptor.ts`, `timeline/components/timeline-element.tsx`, `properties/registry.tsx` (+ optional `update-pipeline.ts`, `media/audio.ts`, storage migration).
- **Persistence**: IndexedDB/OPFS adapters + migration runner at v31 (`services/storage/migrations/`, transformers + colocated bun tests).
- **Conventions**: Bun 1.2.18, turbo, ESLint flat config with custom `opencut/prefer-object-params` rule (all functions take a single object param — mirrors the Rust bridge macro convention), strict TS, `T`-prefixed data types, kebab-case files, manager classes with subscribe/notify, Command-pattern undo.
- **rust/**: crates `time`, `bridge` (proc-macro `#[export]`), `gpu`, `effects`, `masks`, `compositor`; `rust/wasm` builds published `opencut-wasm`. `apps/desktop` is a GPUI stub (one window, static text) — no IPC anywhere.
- **Root workspaces**: `["apps/*", "packages/*"]` — `packages/` declared but **does not exist yet**; we will create it.

---

## 3. Target Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ apps/desktop (NEW, Tauri v2 shell — platform concerns only)        │
│  Rust commands:                                                    │
│   antigravity_{status,login,run,cancel}      (spawn agy, stream)   │
│   hyperframes_{doctor,render,cancel}         (spawn node+CLI)      │
│   studio_{open,read,write,close}             (spawn preview srv)   │
│   fs/layout helpers, path validation, env probing                  │
│  Events → webview: antigravity-chunk, hf-render-progress, …       │
└───────────────▲────────────────────────────────────────────────────┘
                │ Tauri IPC (invoke + events), capability-scoped
┌───────────────┴────────────────────────────────────────────────────┐
│ apps/web (unchanged deploy target; feature-gated native layer)     │
│  packages/hyperframes (NEW TS pkg): prompt builder, seed composer, │
│    types, extractHtml/validate helpers, capability gate            │
│  Editor:                                                           │
│    HyperframesElement ──▶ scene-builder ──▶ HyperframesNode        │
│    PreviewPanel: sandboxed <hyperframes-player> DOM overlay        │
│    AIPanel (chat) │ Properties: source/duration/render controls    │
│    Export pre-flight: ensure rendered clips (auto-invoke render)   │
└───────────────▲────────────────────────────────────────────────────┘
                │ opencut-wasm (unchanged)
┌───────────────┴────────────────────────────────────────────────────┐
│ rust/crates (existing) + NEW rust/crates/hyperframes               │
│  stream-json event model + parsing, composition validation,        │
│  master/child normalize-append, file layout, arg builders          │
│  (used natively by apps/desktop; wasm-exposed pieces optional)     │
└────────────────────────────────────────────────────────────────────┘
```

**Key decisions & rationale**

1. **Tauri v2 wraps the web app rather than replacing it.** Release builds load the deployed editor URL (or `next dev` in dev) with Tauri capabilities scoped to that origin (`"remote": { "urls": [...] }` in capability context) so IPC works from the remote page. The web build gains a thin capability gate (`isNative()`) — everything degrades gracefully in pure-browser mode (edit/preview yes; agent/render no).
2. **Native element type, DOM-overlay preview.** Interactive preview uses a real sandboxed iframe positioned over the compositor canvas (only viable way to run GSAP/video-bearing HTML faithfully); the compositor consumes a **poster texture** (first frame / last rendered frame) via the existing `"rendered"` upload path. Export always goes through CLI-rendered MP4 → imported as ephemeral video asset. This avoids inventing an HTML-rasterization engine and keeps the wgpu pipeline untouched.
3. **Process contract logic lives in `rust/crates/hyperframes`.** Per AGENTS.md, non-UI logic belongs in rust/. The crate owns: agy argument construction, stream-json parsing/extraction, HTML extraction/validation, master/child normalization, disk layout rules. `apps/desktop` commands stay thin wrappers. Prompt-template assembly (needs editor-state types) stays in `packages/hyperframes` TS — revisit moving it into the crate + wasm if GPUI desktop ever needs it.
4. **System Node 22+ is a documented prerequisite** for render/studio (replaces Electron's `ELECTRON_RUN_AS_NODE` trick). `hf_doctor` probes node/npm/FFmpeg/Chrome-puppeteer and drives a setup screen. (Bundling a Node sidecar is explicitly out of scope v1; noted as future work.)
5. **Auth stays outside the app.** Antigravity CLI owns OAuth in the OS keychain; OpenCut only launches the interactive login and reads structured output. No tokens ever enter the webview or project files.

---

## 4. Workstreams

### WS1 — Tauri v2 desktop shell (`apps/desktop`)

Rename the GPUI stub `apps/desktop` → `apps/desktop-gpui` (update root `Cargo.toml` members), introduce `apps/desktop` as the Tauri app.

- Scaffold: `tauri.conf.json` (identifier `pro.opencut.desktop`), devUrl `http://localhost:3000`, frontendDist/loader = remote URL for release (configurable via env at build time), window min-size, title `OpenCut`.
- Capabilities: scope `core:event`, `core:window`, custom commands to the editor origin only. Enable `dangerousRemoteDomainIpcAccess` equivalent (v2 capability `remote.urls`).
- Single-instance plugin; deep-link scheme `opencut://` (future project handoff).
- State: `Mutex<AppState>` holding active antigravity runs (requestId → child), active studio server (pid/port), render jobs.
- Process discipline: never `shell: true`; `CREATE_NO_WINDOW`/`windowsHide`; UTF-8 lossy decoding; tree-kill on Windows (`taskkill /T /F` fallback after `Child::kill`); watchdog timers (agent 21 min, render 30 min, studio startup 25 s).
- Deliverables: `bun dev` + `cargo tauri dev` opens the running Next editor inside WebView2; `ping` command callable from the editor page; `bun run desktop:dev` turbo task wired at root.

### WS2 — `rust/crates/hyperframes` (+ thin wasm exposure later if needed)

Modules (pure, unit-tested, no Tauri deps):

- `agy.rs` — arg builder (exact contract above), `StreamEvent` model, `parse_stream_json(raw) -> ParsedTurn { conversation_id, usage, final_text, warnings }`, `account_from_output()`, `version_meets(min)`, `extract_error(stdout, stderr)`.
- `composition.rs` — `validate(html) -> Result<CompositionInfo>` (requires `data-composition-id`; extracts duration ≤ 3600 s clamp, width/height defaults 1920×1080, size cap 1,000,000 chars); `extract_html(text)` (prefer ```` ```html ```` fence containing `data-composition-id`, else doctype match); `seed_composition(spec)`; `normalize_child()` + `append_child_to_master()` (port of `normalizeHyperframesChildComposition`/`appendChatHost`, incl. `data-gravity-frames-master` marker and `<!--chat-insert-->` semantics).
- `layout.rs` — project-dir schema under app-data: `projects/<projectId>/hyperframes/<elementId>/{index.html, compositions/*.html, renders/scene.mp4}`; id validation `/^[a-zA-Z0-9_-]+$/`; atomic write helper.
- `media_refs.rs` — rewrite internal media refs ↔ portable `file:///` URLs, confined to the composition directory.
- Tests: fixtures copied from Gravity Frames outputs + hand-built edge cases (fence-less replies, multiple fences, CRLF, huge lines).

### WS3 — Native `hyperframes` element type in `apps/web`

Touch points (following `GraphicElement` precedents):

1. `timeline/types.ts`:
   ```ts
   export interface HyperframesElement extends BaseTimelineElement {
     type: "hyperframes";
     compositionId: string;              // stable data-composition-id
     html: string;                       // v1 inline; cap 1MB (file-backed later)
     width: number; height: number;
     renderedMediaId?: string;           // set after successful render
     renderHash?: string;                // sha256(normalized html + refs)
     agent?: { conversationId?: string; model?: string; updatedAt?: string };
   }
   ```
   Add to unions + `VISUAL_ELEMENT_TYPES`; **not** in `MASKABLE_ELEMENT_TYPES` v1; trim allowed within intrinsic duration; excluded from speed-retiming v1.
2. `placement/compatibility.ts`: `hyperframes → "video"` track.
3. `insert-element.ts` validation branch; `element-utils.ts` builder `buildHyperframesElement({...})`.
4. `scene-builder.ts` → new `HyperframesNode` (extends `VisualNode` like `graphic-node.ts`): carries html hash + poster source; `resolve.ts` resolver supplies poster bitmap (from render cache or extracted first-frame); `frame-descriptor.ts` emits it as a standard layer texture.
5. Timeline clip UI (`timeline-element.tsx`): gradient card + sparkles icon + duration; amber badge `● unrendered` vs green `rendered`.
6. Properties panel (`properties/registry.tsx`): Source tab (html size/compositionId/updatedAt, "Edit in Studio", "Copy HTML", paste-replace), Timing (duration within intrinsic), Render section (status, Render now, progress bar).
7. Storage migration `v31-to-v31→v32`: additive; legacy projects unaffected. Colocated bun test.
8. Insertion entry points: Assets panel new tool "AI Scene"; toolbar button; drag creates 5 s element at playhead (mirrors Gravity Frames' blank-scene flow).
9. Undo/redo: reuse `InsertElementCommand`/`UpdateElementsCommand` (html swaps are ordinary element updates → checkpoint before agent writes).

Acceptance: insert/move/trim/split/delete/persist/reload; poster renders through compositor; zero regressions in existing element tests.

### WS4 — Live preview overlay (sandboxed player)

New: `apps/web/src/hyperframes/` —

- `player-loader.ts`: dynamic `import("@hyperframes/player")` (side-effect web component registration), only when an element is active.
- `prepare-preview-html.ts` (in `packages/hyperframes`): strip external GSAP tags → inline bundled `gsap/dist/gsap.min.js?raw`; append bridge script (port of `previewBridgeSource`, retargeted message tag `opencut-hf-preview`).
- `preview-overlay.tsx`: mounted inside PreviewPanel above the canvas; subscribes to renderer viewport transform to project element quad → CSS-positioned container; renders `<hyperframes-player width={el.width} height={el.height}>` with srcdoc; on html change: remove `allow-same-origin`, reset srcdoc.
- Playback sync: playback-manager remains authoritative; effects translate `getCurrentTime()` → `player.seek(t − el.startTime)`; play/pause via command bus (dedup counters, as proven upstream); `timeupdate/state/ended` messages write time back only when the element is solo-active (avoid fighting Remotion-style global clock — here the compositor has no clock, so overlay IS the clock for that span; RAF loop pauses canvas repaint while overlay active).
- Resolution: overlay renders native element resolution scaled by viewport zoom (quality selector applies only to canvas posters — acceptable v1).
- Multi-element spans: topmost intersecting hyperframes element gets the overlay; others display posters (documented limitation; render-on-export unaffected).
- Security tests: attempt `parent.postMessage` from comp → blocked; `window.opener` null; no `allow-same-origin`; CSP allows `blob:`/`data:` frames only from our srcdoc writer.

Acceptance: seeded GSAP comp scrubs frame-accurately with timeline; keyboard shortcuts work; ended → playhead lands at element end.

### WS5 — Antigravity agent layer

Rust commands (`apps/desktop/src/commands/antigravity.rs`, logic in crate):

| Command | Payload → Result | Notes |
|---|---|---|
| `antigravity_status` | → `{ installed, executablePath?, version?, minimumVersionMet, accountEmail?, accountPlan?, models }` | env-var → known-path → PATH resolution; caches last-known account |
| `antigravity_login` | → `{ launched }` | detached interactive spawn, `unref` |
| `antigravity_run` | `{ requestId, projectId, elementId, prompt, conversationId?, model? }` → final `ParsedTurn` | guards: dup requestId, 120k cap, status+version; cwd `projects/<projectId>/agent-workspace`; emits `antigravity-chunk` `{requestId, stream, chunk}`; watchdog 21 min |
| `antigravity_cancel` | `{ requestId }` | tree-kill + state cleanup |

Web side:

- `packages/hyperframes/src/prompt.ts`: port `buildAgentPrompt` + `seedComposition`, parameterized by **project canvasSize/fps** (not hardcoded 1920×1080/30 — improvement over upstream), element intrinsic duration, recent turns (≤6), optional reference-image path list (v1.1).
- `AIPanel` (left tools tab "AI Motion"): per-element chat history (persisted on element + capped 99), streaming activity line, model picker (seed with upstream's 14-entry list), account chip (email/plan from status), Connect/Login button, cancel button, error taxonomy (not-installed / too-old / auth / timeout / no-html).
- Turn loop: build prompt → `invoke('antigravity_run')` → on success `extract_html` (returned by Rust) → `validate` → `editor.timeline.updateElements` with html + `agent.conversationId` + recomputed intrinsic duration (clamped, ripple-aware) → checkpoint undo → toast "Scene updated".
- Conversation continuity: `--conversation` on subsequent turns; clearing chat resets id.

Acceptance: blank element → "kinetic title intro, 5 s" → comp generated + previewable; follow-up "make it red" refines same conversationId; airplane-mode yields graceful system message.

### WS6 — Render pipeline & export integration

Rust commands:

| Command | Behavior |
|---|---|
| `hf_doctor` | probes: node ≥22 (`node --version` via PATH + known dirs), FFmpeg, Chrome availability for puppeteer, hyperframes CLI version (`npx hyperframes --version` pinned dep resolution), Antigravity status. Drives Setup screen. |
| `hf_render` | `{ projectId, elementId, html }` → validates (crate), writes `index.html` (+ copies `compositions/` if master), rewrites media refs to file URLs, spawns `node <cli.mjs> render -o renders/scene.mp4` with cwd = composition dir, emits `hf-render-progress` chunks, 30-min watchdog → returns `{ mp4Path, durationSec }` |
| `hf_render_cancel` | kill job |

Web side:

- After success: read mp4 `File` via Tauri fs plugin scope → `editor.media.addMediaAsset({ ephemeral: true, type:"video", ... })` (mediabunny probes duration/thumbnail) → set `element.renderedMediaId`, `renderHash`.
- Cache invalidation: any html update clears `renderedMediaId` (badge flips).
- **Export pre-flight** (`renderer-manager.exportProject` wrapper): collect dirty hyperframes elements → sequential auto-render with modal progress "Rendering AI scenes (1/2)…" → then normal mediabunny export (rendered clips are ordinary videos incl. their mixed audio).
- Pure-web degradation: unrendered hyperframes elements block export with explanatory dialog; previously-rendered assets remain usable (they're regular media).
- Concurrency: max 1 render job v1 (headless Chrome memory); queue UI.

Acceptance: sample project (video + AI scene + music) exports end-to-end; AI scene audio present; re-export skips unchanged hashes.

### WS7 — HyperFrames Studio embedding

- `studio_open { projectId, elementId }`: ensure dir + master `index.html` (crate: create-or-normalize), pick free port, spawn `node <cli.mjs> preview <dir> --port <N> --force-new --no-open --no-proxy`, await stdout URL (25 s), return `{ url, port }`; front-end opens child `WebviewWindow("hyperframes-studio")` at that URL.
- Sync: **main → studio** = write `index.html` directly (live reload picks it up); **studio → main** = Rust polls mtime/hash every 1 s while open, emits `studio-html-changed`; web commits into element (clears rendered cache). HTTP-API round-trip (`GET/PUT /api/projects/<name>/files/<path>` + `If-Match`) kept as fallback behind a flag.
- Append flow (chat-generated children when master exists): crate `append_child_to_master` writes `compositions/NNN-chat-<slug>.html`, appends host div, extends master `data-duration`; mirrors upstream semantics.
- `studio_close` on window destroy/app exit; singleton guard.

Acceptance: open Studio on an element, tweak timing attrs, change lands on timeline ≤ ~1 s; render uses children dir correctly.

### WS8 — Security hardening checklist

- Renderer↔native boundary only via explicit commands; capability file scopes remote origin; deny-by-default fs plugin scopes (`$APPDATA/projects/**`).
- All FS path construction passes id regex + containment check; atomic writes.
- Generated HTML: opaque-origin sandbox always; no `allow-same-origin` ever re-added; bridge is the only channel; prompt forbids network/storage/shell and the agent runs with restricted tools (upstream wording preserved).
- Prompts: 120k cap enforced in Rust (authoritative) + UI counter.
- No secrets handling added (auth stays in agy/keyring; no API keys introduced).
- Supply-chain: pin `hyperframes`/`@hyperframes/player` versions; lockfile audit in CI.

### WS9 — Testing / CI / DX

- `bun test`: prompt snapshots, extract/validate, migration v32, store selectors, bridge script unit tests (jsdom-ish harness for postMessage contract).
- `cargo test`: crate modules (stream-json fixtures incl. real captured transcripts sanitized), layout/id safety, normalize/append golden tests.
- CI: existing wasm-pack workflow + `cargo clippy/test` for new crate + tauri build smoke (PR-labeled).
- Manual E2E checklist doc (`docs/qa-hyperframes.md`): install-fresh walkthrough (doctor → login → generate → preview → studio tweak → render → export).

---

## 5. Milestones

| # | Scope | Est. (eng-days) | Exit criteria |
|---|---|---|---|
| **M0** | Repo scaffolding: rename GPUI stub, Tauri shell boots editor, capability-gated `isNative()`, root tasks | 3–5 | Editor runs in WebView2 via `desktop:dev`; ping IPC OK; CI green |
| **M1** | Element type plumbing (types → nodes → poster texture → properties → timeline UI → migration) | 5–8 | Full CRUD + persistence + undo; poster in compositor; tests |
| **M2** | Sandbox preview overlay + playback sync | 5–7 | Frame-accurate scrub/play; sandbox probes fail closed |
| **M3** | Rust crate + `hf_doctor`/`hf_render` + export pre-flight + rendered-asset attach | 5–8 | End-to-end render→export incl. audio; doctor gates UX |
| **M4** | Antigravity commands + chat panel + prompt builder + turn loop | 6–9 | Blank→generated→refined conversation; error taxonomy |
| **M5** | Studio embedding + master/child append | 5–7 | Live two-way sync; appended chats extend duration |
| **M6** | Hardening, packaging (NSIS/MSI, updater config), QA docs, degraded-mode polish | 4–6 | Signed-ish build; fresh-machine walkthrough passes |

**Total ≈ 33–50 eng-days.** M1/M2 are browser-safe and parallelizable with M3/M4 (different owners feasible). M5 depends on M3 (layout) + M4 (append triggers).

---

## 6. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Tauri remote-origin IPC friction (CSP/capability quirks, WebView2 versions) | Blocks M0 | Fallback: embedded localhost server plugin serving the built app; keep bridge thin so swap is cheap |
| `@hyperframes/player` behavior differs in WebView2 vs Chrome | Preview fidelity | Same Chromium lineage; verify early in M0 spike with sample comp incl. shader-loading attr |
| Generated comps depend on CDN scripts (offline breakage) | Preview/export failures | Inline bundled GSAP like upstream; doctor warns on other CDN deps; lint hook later |
| System-Node prerequisite surprises users | Support burden | Doctor-driven setup screen with copy-paste fix; detect winget/choco hints |
| agy CLI drift (flags/auth/output shape) | Agent breaks | Adapter trait + fixture corpus; version gate constant; upstream watch in release checklist |
| Studio server API/flag drift across hyperframes versions | M5 breaks | Pin CLI version; file-write/live-reload primary path avoids HTTP API dependence |
| Big HTML strings inflate IndexedDB project blobs | Quota issues | 1 MB inline cap + file-backed mode (WS7 dirs) flagged as v1.1 |
| mediabunny ingest of CLI mp4 edge cases (fps/timebase) | Export stalls | Probe in M3 acceptance; transcode fallback via FFmpeg if needed (doctor knows FFmpeg) |
| Two clocks (overlay vs RAF canvas) cause jank | UX | Pause canvas repaint while overlay active (documented in WS4) |
| Windows process-tree kills leak chrome.exe | Resource leaks | Job-object assignment for spawned trees; watchdog reap on next launch |

---

## 7. Out of scope (v1, tracked as follow-ups)

- Bundling Node/FFruntime sidecars (zero-install render)
- Lambda/cloud render paths (`hyperframes lambda|cloud render`)
- Reference-image attachments in chat (v1.1 — file drop → agent-workspace copy)
- File-backed composition storage replacing inline HTML (v1.1)
- Mask/effects on hyperframes elements; speed retiming
- GPUI desktop parity
- Patching Studio's bundle JS to show master clips in its timeline (upstream's approach — unnecessary for our file-sync model)

---

## 8. Appendix A — Exact native contracts

**agy run**
```
argv: ["--dangerously-skip-permissions", "--print", PROMPT,
       "--output-format", "stream-json", "--print-timeout", "20m"]
       + ["--conversation", ID]?  + ["--model", NAME]?
env : parent minus AGY_CLI_HIDE_ACCOUNT_INFO
cwd : projects/<projectId>/agent-workspace
```
Events parsed per line; result: `{ text, conversationId?, usage?, error? }`.

**studio open**
```
node <hyperframes>/bin/hyperframes.mjs preview DIR --port N --force-new --no-open --no-proxy
```
Ready = URL seen on stdout ≤ 25 s.

**render**
```
cwd  = projects/<pid>/hyperframes/<eid>/
node <hyperframes>/bin/hyperframes.mjs render -o renders/scene.mp4
```
Pre: media refs rewritten to file URLs inside dir; `compositions/` copied if referenced.

## 9. Appendix B — Source → destination map (Gravity Frames → OpenCut)

| Upstream file | Port to | Notes |
|---|---|---|
| `src/main/services/antigravity.ts` | `rust/crates/hyperframes/src/agy.rs` + `apps/desktop` cmd | parsing/version/env logic in crate |
| `AntigravityChat.tsx` prompt/seed/extract | `packages/hyperframes/src/{prompt,seed,extract}.ts` | parameterize canvas/fps |
| `services/hyperframesPreview.ts` bridge | `apps/web/src/hyperframes/prepare-preview-html.ts` | retag messages |
| `HyperframesScenePlayer.tsx` | `apps/web/src/hyperframes/preview-overlay.tsx` | viewport projection replaces absolute canvas |
| `services/hyperframes.ts` (render) | `apps/desktop` `hf_render` + crate `layout.rs`/`media_refs.rs` | node detection replaces ELECTRON_RUN_AS_NODE |
| `services/hyperframesStudio.ts` (master/child) | `rust/crates/hyperframes/src/composition.rs` | golden tests |
| `ExportDialog.startExport` pre-render | `renderer-manager.exportProject` wrapper | queue UI |
| store `seekTarget/playbackCommand` buses | playback-manager subscriptions | same dedupe-counter trick |

---

*Prepared from source-level analysis of `heygen-com/hyperframes` (README/docs), `E:\CodingFolder\hyperframes-antigravity-integration` (full subsystem trace), and `E:\CodingFolder\OpenCut-classic` (architecture survey).*
