# Rhymx → OpenCut Plugin Plan

Port the core features of **RhymxAIWebEditor** (`E:\CodingFolder\WebAIEditor\RhymxAIWebEditor`) into OpenCut as a self-contained plugin. OpenCut already owns timeline, preview, render, export, persistence, and undo — the plugin only adds *intelligence* (AI scene planning, stock auto-matching, motion templates, advanced captions) on top of OpenCut's existing extension seams.

---

## 1. Feature inventory (what Rhymx has that we port)

| # | Feature | Source in Rhymx | Port? |
|---|---------|-----------------|-------|
| F1 | Voiceover transcription w/ word-level timing | `src/platform/web/browserPlatform.ts:355` (Groq Whisper) | Partial — OpenCut has on-device Whisper (`apps/web/src/transcription/`); add Groq as cloud provider for **word timings** |
| F2 | Scene segmentation from transcript | `browserPlatform.ts:270-325` (`scenesFromTranscript`) + `core/scenes/` | Yes (pure TS, zero deps) |
| F3 | LLM visual planner: per-scene `visualIntent`, 3 keywords, `treatment: media\|motion` | `core/scenes/sceneIntelligence.ts:25-91` | Yes (prompt/parser verbatim) |
| F4 | Heuristic keyword fallback | `core/scenes/searchKeywords.ts` | Yes |
| F5 | Multi-provider stock search + scoring + acquire | `browserPlatform.ts:513-1229` (Pexels, Pixabay, Archive.org, NASA, Wikimedia), `core/media/pexelsVideoFiles.ts` | Yes |
| F6 | Approval contact sheet (review matches before download) | `src/renderer/.../ApprovalContactSheet.tsx` | Yes (rebuilt in OpenCut UI kit) |
| F7 | Motion graphics templates — 14 parametric templates, manifest registry | `src/motion/templates.ts`, rendered in `remotion/Composition.tsx:376-760` | Yes — **re-implemented natively** (see §4) |
| F8 | HyperFrames companion (GSAP+FFmpeg local render server) | `scripts/local-motion-server.mjs` | Deferred — optional Phase 5; native canvas port makes it unnecessary for all 14 templates |
| F9 | Word-timed caption modes: sentence / active-word / karaoke / word / phrase / keywords | `types/editor.ts:71-77`, `Composition.tsx:294-370` | Yes — extends OpenCut's subtitles domain |
| F10 | SRT/VTT import/export | `renderer/utils/captions.ts` | No — OpenCut already parses SRT/ASS (`apps/web/src/subtitles/`) |
| F11 | BYOK settings + hosted Cloudflare worker proxy | `ProjectSettingsDialog.tsx`, `worker/index.js` | Optional Phase 5 — plugin API routes with server-side keys instead |

**Not ported** (OpenCut owns them): timeline interactions, snapping, preview player, export pipeline, media storage/persistence, undo/redo, project management, autosave.

---

## 2. Target architecture

### 2.1 Where the plugin lives

```
apps/web/src/plugins/rhymx/
├── index.ts                     # registerRhymxPlugin(): single entry, called from EditorCore init
├── README.md                    # plugin contract, env vars, provider keys
├── types.ts                     # ScenePlan, ScenePlanItem, StockMatch, MotionTemplateManifest …
├── ai/
│   ├── groq-client.ts           # shared Groq fetch helper (BYOK or server proxy)
│   ├── transcribe.ts            # F1 cloud provider adapter (word-level JSON)
│   ├── scene-planner.ts         # F3 prompt builder + response parser (ported verbatim)
│   └── keyword-heuristics.ts    # F4 stop-word filtering + frequency ranking
├── scenes/
│   ├── segmentation.ts          # F2 timed words → SceneSegment[]
│   ├── orchestrator.ts          # voiceover→plan→timeline pipeline; ONLY writes via commands
│   ├── stock-search.ts          # F5 provider adapters (pure fetch, no SDKs)
│   ├── scoring.ts               # scoreCandidate() relevance/duration/orientation/license
│   └── acquirer.ts              # download blob → editor.media.addMediaAsset → element insert
├── motion/
│   ├── registry.ts              # MotionTemplateRegistry extends DefinitionRegistry
│   ├── register-templates.ts    # registers all 14 as GraphicDefinitions (§4)
│   ├── animation.ts             # shared easing (easeOutCubic etc.), progress solver
│   └── definitions/             # one file per template (hero-title.tsx, statistic.tsx, …)
│       ├── hero-title.ts        ├── statistic.ts        ├── quote.ts
│       ├── progress-bar.ts      ├── lower-third.ts      ├── split-comparison.ts
│       ├── checklist.ts         ├── countdown.ts        ├── chapter-card.ts
│       ├── social-callout.ts    ├── feature-grid.ts     ├── kinetic-title.ts
│       ├── product-card.ts      └── end-card.ts
├── captions/
│   ├── modes.ts                 # F9 mode strategies (cue-splitting + word emphasis)
│   └── word-cues.ts             # word timing → cue list per mode
├── state/
│   └── rhymx-store.ts           # zustand slice: wizard step, plan draft, match results,
│                                # provider keys cache, busy/error flags. NO timeline state.
├── ui/
│   ├── ai-panel-view.tsx        # assets-panel "AI" tab content (wizard)
│   ├── approval-sheet.tsx       # F6 contact sheet dialog
│   ├── motion-library-view.tsx  # template grid + live preview thumbnails
│   ├── motion-params-form.tsx   # per-template field editors (text/number/color/bool)
│   └── settings-section.tsx     # BYOK keys UI inside Settings tab
└── api/                         # thin Next.js route handlers (server-side keys)
    └── ../app/api/rhymx/
        ├── plan/route.ts        # POST → LLM scene plan (proxy, rate-limited)
        ├── media-search/route.ts
        └── transcribe/route.ts  # optional cloud whisper proxy
```

### 2.2 Integration seams (existing OpenCut extension points — no new mechanisms)

| Plugin need | OpenCut seam | File |
|---|---|---|
| Register motion templates | `graphicsRegistry` (DefinitionRegistry) + call `registerRhymxMotionTemplates()` next to `registerDefaultGraphics()` | `apps/web/src/graphics/registry.ts`, `apps/web/src/core/index.ts:33` |
| Template params editable in properties panel | `elementParamRegistry` + `getPropertiesConfig()` graphic case → GraphicTab renders params generically | `apps/web/src/components/editor/panels/properties/registry.tsx` |
| Template insertion onto timeline | `InsertElementCommand` via `editor.command.execute` (undoable, validated by placement engine) | `apps/web/src/core/managers/timeline-manager.ts` |
| Bulk AI edits (whole plan application) | `TracksSnapshotCommand` batches = single undo step | `apps/web/src/commands/timeline/` |
| AI panel entry point | Add `"ai"` key to `TAB_KEYS`/`tabs` + view in `viewMap` (same pattern as sounds/stickers) | `apps/web/src/components/editor/panels/assets/assets-panel-store.tsx:18`, `panels/assets/index.tsx` |
| Media download → library | `MediaManager.addMediaAsset` (blobs persisted automatically) | `apps/web/src/core/managers/media-manager.ts` |
| Provider keys / network calls | Next.js route handlers mirroring `api/sounds/search` (+ Upstash rate limit); BYOK option passes client key through | `apps/web/src/app/api/sounds/search/` precedent |
| Post-mutation housekeeping (e.g. invalidate stale renders) | `command.registerReactor(fn)` | `apps/web/src/core/managers/commands.ts` |
| Keyboard/action wiring (e.g. "Generate scenes…") | `actions/definitions.ts` + `invokeAction` | `apps/web/src/actions/docs` (`docs/actions.md`) |

### 2.3 Data flow (voiceover → edited timeline)

```
audio file
  │ (transcription: on-device transformers.js OR Groq cloud w/ word timings)
  ▼
TranscriptResult { segments, words[] }
  │ segmentation.ts  (≥5s span, or ≥2.5s at sentence end)
  ▼
SceneSegment[] { id, start, end, transcriptText, words[] }
  │ scene-planner.ts (LLM, JSON mode) ──fallback──▶ keyword-heuristics.ts
  ▼
ScenePlan { items: [{ sceneId, visualIntent, keywords[3], treatment }] }
  │ orchestrator.ts
  ├─ treatment=media ─▶ stock-search + scoring ─▶ ApprovalSheet (human review)
  │                                               │ approve ─▶ acquirer ─▶ MediaManager
  │                                               ▼
  ├─ treatment=motion ─▶ pick template from registry (params prefilled from visualIntent)
  ▼
TracksSnapshotCommand:
  video elements @ scene times (main track) · motion graphics · text cues (captions)
  ▼
OpenCut handles everything else (preview, undo, autosave, export)
```

---

## 3. Key design decisions

### D1 — Motion templates become native OpenCut **graphics**, not Remotion
Rhymx renders templates inside a Remotion composition; OpenCut's renderer is its own WebGPU/canvas compositor (`services/renderer/`). Keeping Remotion would mean a second render engine and divergent preview vs export. Instead each template becomes a `GraphicDefinition` whose `render(ctx)` draws the frame for time `t`. Preview and export are automatically identical because both go through `CanvasRenderer.render()`.

**Time-awareness problem & fix:** today `GraphicRenderContext` is `{ctx, params, width, height}` and `GraphicNode.getSource()` caches the canvas by `JSON.stringify(resolvedParams)` (`nodes/graphic-node.ts:43`). Params resolved per-frame via `resolveGraphicElementParamsAtTime` means keyframed params already re-render per frame. Two options:

- **Chosen — small upstream change (~15 lines):** thread element-local time into the render context.
  - `graphics/types.ts`: add `localTime: number; durationSec: number` to `GraphicRenderContext`.
  - `resolve.ts:289` already computes `visualState.localTime` — pass it through to `getSource`.
  - `graphic-node.ts`: include `localTime` quantized to frame in `cacheKey`; pass to `definition.render`.
  - Backward compatible (existing graphics ignore the new fields).
- **Fallback (zero upstream change):** generator inserts two linear keyframes on a hidden numeric param `params._t` (0 → duration). Interpolation yields a clock; templates derive all choreography from `_t`. Works today but pollutes params and costs ~2 keys × every animated property internally anyway.

Templates also need non-square sources (lower thirds are wide). Extend `GraphicDefinition` with optional `sourceWidth/sourceHeight` (default 512×512) consumed in `GraphicNode.getSource` and `frame-descriptor.ts:226`.

### D2 — Orchestration writes only through commands/managers
The AI never mutates tracks directly. All inserts go through `InsertElementCommand` / `AddTrackCommand`; whole-plan application is wrapped in one `TracksSnapshotCommand` so a full auto-edit is a single Ctrl+Z. This preserves undo, autosave, track pruning reactor, and drag-preview semantics for free.

### D3 — Reuse OpenCut transcription; add Groq only for word timings
OpenCut's `transcription/` (transformers.js, incl. `whisper-large-v3-turbo`) returns segment-level text without word timestamps. Karaoke/active-word caption modes and sentence-boundary segmentation need words. Plan: if an OpenCut transcription exists, offer "enhance with word timings (Groq)" as an upgrade step; otherwise run Groq directly. Both produce the same internal `TimedWord[]`.

### D4 — Captions extend the existing subtitles domain
OpenCut builds text elements from cues (`subtitles/build-subtitle-text-element.ts`). The plugin contributes **mode strategies**: given word-timed cues + style, emit the appropriate text-element set (sentence = current behavior; phrase = 3-word chunks; karaoke/active-word = per-word emphasis via styled sub-runs or stacked highlight elements). Ship sentence/phrase first; karaoke in Phase 4 (may need multi-run text support — assess then).

### D5 — Keys stay server-side by default, BYOK optional
Route handlers under `app/api/rhymx/*` hold `GROQ_API_KEY`, `PEXELS_KEY`, `PIXABAY_KEY` (env). Power users can paste their own keys in the plugin settings section, which are then called direct-from-browser exactly like Rhymx does (keys never hit our server).

### D6 — Rust alignment (AGENTS.md migration direction)
Pure, framework-free logic moves to a new crate when stabilized: `rust/crates/rhymx-core` (segmentation thresholds, keyword heuristics, candidate scoring, prompt/schema validation) exposed via `#[export]` + `rust/wasm` module. Template drawing stays TS (canvas 2D lives there). This is Phase 5 hardening — ship TS first, keep modules pure so the lift is mechanical.

---

## 4. Motion template port map (Remotion JSX → canvas 2D)

Each Rhymx template is a pure function of frame progress: entrance eased-cubic over 0.8 s, exit over last 0.55 s (`Composition.tsx:382-387`). Port formula:

```
render({ctx, params, width, height, localTime, durationSec}):
  p  = easeOutCubic(clamp(localTime / 0.8))          // entrance
  ex = clamp((durationSec - localTime) / 0.55)       // exit factor
  draw layered shapes/text using params.* values
```

| Template | Canvas strategy | Params carried over |
|---|---|---|
| hero_title | big type slide-up + fade, accent underline wipe | title, subtitle, accentColor |
| statistic | counting number (lerp by p), label, accent bar fill | value, suffix, label |
| quote | glass card fade-scale, quotation mark, attribution | quote, author |
| progress_bar | rounded rect + animated fill + % counter | percent, label |
| lower_third | sliding bar + name/role reveal | name, role |
| split_comparison | two staggered cards slide from opposite sides | leftTitle, rightTitle, leftValue, rightValue |
| checklist | rows appear staggered, checkmark stroke-dash draw | items (newline-sep text param) |
| countdown | pulsing ring arc + numeral swap | seconds, label |
| chapter_card | giant numeral + title mask-reveal | number, title |
| social_callout | glassy card, icon dot pulse, handle | handle, message |
| feature_grid | 2×2 numbered cells stagger-in | item1..item4 |
| kinetic_title | per-word rotationX cascade (back.out) | title |
| product_card | glass card slide + rotationY, price chip | name, price, tagline |
| end_card | blur-scale title + CTA pill pop | title, cta |

All 14 are achievable with canvas 2D primitives (rects, roundRect, text, arcs, gradients, globalAlpha/composite). The three "hyperframes" ones (kinetic/product/end) lose GSAP-grade blur/grain ambience initially — acceptable simplification, noted in template descriptions.

**Manifest → definition mapping:** Rhymx `MotionTemplateManifest.fields[]` (text/number/color/boolean) map 1:1 to OpenCut `ParamDefinition` union (text/number/color/font/boolean/select) — so the properties panel gets per-template editing for free via `GraphicTab`.

---

## 5. Phases & milestones

### Phase 0 — Scaffold (½ day)
- [ ] Create `plugins/rhymx/` tree (§2.1) with `types.ts` and empty registries.
- [ ] Call `registerRhymxPlugin()` from EditorCore init path (next to `registerDefaultEffects()`, `core/index.ts:33`).
- [ ] Add `"ai"` tab key + icon + placeholder view; verify panel builds.
- **Done when:** tab visible, no regressions, lint/tsc clean.

### Phase 1 — Motion templates native (2–3 days) ← highest standalone value
- [ ] Upstream micro-change: `GraphicRenderContext.localTime/durationSec` + per-frame cacheKey + optional `sourceWidth/sourceHeight` (D1).
- [ ] `motion/animation.ts`: easings, progress solver, exit solver (port `Composition.tsx:376-405` math).
- [ ] Port all 14 templates (§4 map), one file each; register via `registerRhymxMotionTemplates()`.
- [ ] `ui/motion-library-view.tsx`: grid of templates with live preview (small canvas looping localTime 0→duration) + click-to-insert at playhead; `motion-params-form.tsx` handled by existing properties panel.
- [ ] Tests: snapshot golden frames per template at t=10%,50%,90% via CanvasRenderer headless.
- **Done when:** user browses library, inserts animated template, scrubs/export shows identical animation.

### Phase 2 — Transcript → scene plan (2 days)
- [ ] Port `scenesFromTranscript`, `sceneIntelligence.ts` prompt/parser, `searchKeywords.ts` (pure TS copies, adapt types).
- [ ] `ai/transcribe.ts`: Groq word-level adapter; wire "use existing OpenCut transcription" path (D3).
- [ ] `api/rhymx/plan/route.ts` proxy + rate limit; BYOK direct-call toggle.
- [ ] `rhymx-store.ts`: wizard steps (idle → transcribing → planning → ready), plan draft, error surfaces.
- [ ] `ui/ai-panel-view.tsx`: audio dropzone → progress → editable plan review list (per-scene intent, keywords, treatment chips, inline edit).
- **Done when:** dropping a voiceover produces a reviewable scene plan; heuristic fallback works offline.

### Phase 3 — Stock matching + apply-to-timeline (3 days)
- [ ] Port 5 provider adapters + `scoreCandidate` + hosted-worker client (`stock-search.ts`, `scoring.ts`).
- [ ] `acquirer.ts`: stream-download → blob → `media.addMediaAsset` → keep assetId.
- [ ] `approval-sheet.tsx` dialog: per-scene candidate grid, confidence badges, load-more page, manual query override, skip.
- [ ] `orchestrator.ts` apply: build `CreateVideoElement/CreateImageElement` at scene times (main video track), motion templates for `treatment:"motion"` picks, batch as one `TracksSnapshotCommand`; images default Ken-Burns equivalent (scale keyframes 1→1.12 via existing animations system).
- [ ] Actions entry: `rhymx.applyPlan` registered in actions layer.
- **Done when:** approved plan materializes as a fully populated, single-undo timeline.

### Phase 4 — Word-timed captions (2 days)
- [ ] `captions/modes.ts`: sentence, phrase (3-word), word, keywords-emphasis; emit cues through `build-subtitle-text-element` styling path.
- [ ] Panel section in AI tab: mode picker + style passthrough to existing subtitle controls.
- [ ] Assess karaoke feasibility (multi-run colored text). If TextElement can't express runs, generate per-word overlay elements positioned by timing; document tradeoff.
- **Done when:** user generates styled captions from plan words in ≥3 modes; karaoke decision documented.

### Phase 5 — Hardening & optional infra (ongoing)
- [ ] Settings section: BYOK keys (localStorage/sessionStorage duality like Rhymx), worker URL, connection tests.
- [ ] Optional: port `worker/` Cloudflare functions for keyless hosted search (reuse Rhymx `worker/index.js` nearly verbatim).
- [ ] Optional: HyperFrames companion client for future GSAP-only templates (F8) — native port removed the need for current 14.
- [ ] Rust: extract `rust/crates/rhymx-core` (segmentation, scoring, validation) + wasm bindings (D6); keep TS wrappers as fallback.
- [ ] Docs: `plugins/rhymx/README.md` — env vars, keys, template authoring guide.

---

## 6. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Renderer flagged "under active refactor toward binary rendering" (README) | Template render code may need rework | Templates depend only on `GraphicDefinition.render` contract (stable registry seam), not exporter internals; golden-frame tests catch drift |
| Graphics fixed 512² source distorts wide/lower-third layouts | Visual quality | D1 adds per-definition source size; transform math unchanged |
| Per-frame canvas re-render cost for many animated graphics | Preview fps | Cache keyed by frame-quantized localTime (already how keyframed params behave); templates are lightweight 2D draws |
| LLM output drift / malformed JSON | Broken plans | Keep Rhymx's strict parser + temperature 0.15 + JSON mode + heuristic fallback (F4) — proven design |
| Provider ToS/rate limits (Pexels/Pixabay) | Search failures | Route handlers with Upstash limits (sounds API precedent), hosted-worker option, graceful per-provider degradation |
| Word timings absent from on-device transcription | Karaoke modes blocked | Groq cloud upgrade path (D3); modes degrade to sentence/phrase |
| Timeline placement collisions during bulk apply | Overlapping clips | Use placement engine `{mode:"auto"}` + explicit sequential starts; rely on `nearestAvailableStart`-equivalent behavior in placement/overlap.ts |

## 7. Verification checklist (per phase)

- `bun run typecheck` / repo lint configs after each phase.
- Golden-frame image snapshots for each motion template (Phase 1).
- Unit tests for segmentation/scoring/parser ports (pure functions — direct ports of Rhymx test cases where they exist, e.g. `scripts/local-motion-template.test.mjs` patterns).
- Manual E2E script: drop voiceover → plan → approve 3 media + 1 motion → apply → single undo restores empty timeline → export MP4 contains animations.
