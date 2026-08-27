<div align="center">

# RhymxCut

### A serious video editor with a browser-native interface and a Rust-powered core.

**Fast timeline editing · Native desktop runtime · WebGPU rendering · AI motion design · Private by default**

[Get started](#quick-start) · [Explore the architecture](#architecture) · [Build the desktop app](#desktop-app) · [Contribute](#contributing)

</div>

---

RhymxCut is an ambitious, open-source video editor built for people who want a focused creative tool without surrendering their media or their workflow to a proprietary platform.

This is not a toy canvas wrapped in a landing page. The repository contains a real multi-track editing experience, a GPU-oriented compositor, native and WASM Rust targets, project persistence, media tooling, subtitles, effects, export infrastructure, and an AI-assisted motion-design system—all organized as one coherent workspace.

RhymxCut continues the engineering lineage of **OpenCut Classic**, expanded with a native Tauri desktop shell and HyperFrames + Antigravity integration.

## Why this repository stands out

- **A complete editing surface** — timeline operations, preview, media management, text, subtitles, graphics, effects, masks, guides, retiming, transitions, and export live in one integrated application.
- **Rust where correctness matters** — time, effects, masks, GPU work, composition, and platform bridges are moving into reusable Rust crates instead of being duplicated across frontends.
- **One core, multiple surfaces** — the Next.js web editor and native desktop experience are shells around shared capabilities, not separate products slowly drifting apart.
- **Browser-grade reach, native-grade power** — run the editor on the web or use the Tauri desktop shell for filesystem access, native rendering commands, and local creative tooling.
- **AI as part of the workflow** — HyperFrames compositions and Antigravity tooling are integrated into the editor rather than bolted on as a disconnected prompt box.
- **Local-first media** — the architecture is designed so your footage can remain on your device.
- **Built in the open** — a Bun monorepo, focused architecture documents, automated checks, and a test suite spanning the editor and shared packages.

## Feature map

| Creative workflow | What is already represented in the codebase |
| --- | --- |
| Editing | Multi-track timeline, selection, ripple operations, clipboard commands, speed and retiming tools |
| Visual design | Text, fonts, gradients, stickers, graphics, guides, effects, masks, backgrounds, and animation |
| Audio and captions | Sounds, transcription, subtitle parsing and editing |
| Preview and output | Canvas preview, rendering services, compositor infrastructure, and export workflows |
| Project workflow | Project metadata, persistence, diagnostics, authentication, and media management |
| AI motion design | HyperFrames preview/render pipeline, Studio integration, and Antigravity-powered composition workflows |
| Native desktop | Tauri v2, WebView2, filesystem access, native commands, single-instance handling, and bundled tooling |

## Architecture

RhymxCut is being shaped around one strong boundary: **frontends own interaction; Rust owns portable business logic**.

```text
RhymxCut
├── apps/
│   ├── web/            Next.js editor and browser experience
│   ├── desktop/        Functional Tauri v2 desktop shell
│   └── desktop-gpui/   Experimental GPUI shell
├── rust/
│   ├── crates/         Time, GPU, compositor, masks, effects, and bridges
│   └── wasm/           Rust capabilities compiled for the web editor
├── packages/
│   └── hyperframes/    Shared AI motion-design integration
└── docs/               Architecture and subsystem documentation
```

Platform-independent behavior belongs in `rust/`. Each app under `apps/` remains a replaceable UI shell, which keeps important media logic consistent across the web and desktop experiences.

### Technology

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS
- **Native shell:** Tauri v2 and Rust
- **Media:** WebCodecs-compatible tooling, Mediabunny, WebGPU-oriented rendering
- **Shared core:** Rust crates compiled natively and through WebAssembly
- **Data:** Drizzle ORM, PostgreSQL, Redis-compatible services
- **Tooling:** Bun, Turbo, ESLint, Docker Compose, Cargo
- **Creative AI:** HyperFrames and Antigravity integration

## Quick start

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) with [Docker Compose](https://docs.docker.com/compose/install/) for the local services

Docker is optional when you only need to work on isolated frontend features.

### Run the web editor

From the repository root:

```bash
bun install
```

Create the local environment file:

```bash
# macOS / Linux
cp apps/web/.env.example apps/web/.env.local

# Windows PowerShell
Copy-Item apps/web/.env.example apps/web/.env.local
```

Start the local services and editor:

```bash
docker compose up -d db redis serverless-redis-http
bun dev:web
```

Open [http://localhost:3000](http://localhost:3000). The example environment values already match the Docker Compose configuration.

## Desktop app

The functional desktop application is the Tauri shell in `apps/desktop`. It starts the web editor, opens it in WebView2, and exposes native HyperFrames, Antigravity, render, Studio, and filesystem commands.

```powershell
node .\apps\desktop\script\tauri.mjs dev
```

With Bun installed, this shortcut is equivalent:

```bash
bun run desktop:dev
```

Create a release build with:

```bash
bun run desktop:build
```

See the [desktop guide](apps/desktop/README.md) for prerequisites and troubleshooting. The `apps/desktop-gpui` target is an experimental shell and currently displays a placeholder.

## Local Rust and WASM development

The web editor uses the published `opencut-wasm` package by default. If you are changing the Rust implementation, install the Rust toolchain, `wasm-pack`, and `cargo-watch`, then build and link the local package:

```bash
bun run build:wasm
cd rust/wasm/pkg
bun link
cd ../../../apps/web
bun link opencut-wasm
```

From the repository root, rebuild automatically while working:

```bash
bun dev:wasm
```

Return to the published package with:

```bash
cd apps/web
bun add opencut-wasm
```

## Run the full stack with Docker

```bash
docker compose up -d
```

The production-style app is then available at [http://localhost:3100](http://localhost:3100).

## Useful commands

| Command | Purpose |
| --- | --- |
| `bun dev:web` | Start the Next.js editor |
| `bun run desktop:dev` | Start RhymxCut Desktop in development mode |
| `bun run desktop:build` | Build the desktop application |
| `bun run build:web` | Create a production web build |
| `bun run build:wasm` | Compile the Rust WASM package |
| `bun test` | Run the test suite |
| `bun run lint:web` | Lint the web application |

## Contributing

RhymxCut rewards work across a wonderfully broad surface: timeline ergonomics, rendering performance, project workflows, media tooling, native integration, accessibility, tests, documentation, and UI refinement.

Before making a large architectural change, read [AGENTS.md](AGENTS.md) and the relevant documents in [`docs/`](docs/). The central rule is simple: reusable business logic belongs in Rust; app-specific rendering and interaction belong in the UI shell.

For environment setup and contribution conventions, see the [Contributing Guide](.github/CONTRIBUTING.md).

## Open-source lineage and sponsors

RhymxCut is built from the original OpenCut codebase. The upstream rewrite continues at [opencut-app/opencut](https://github.com/opencut-app/opencut).

Thanks to [Vercel](https://vercel.com?utm_source=github-opencut&utm_campaign=oss) and [fal.ai](https://fal.ai) for supporting open-source software.

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

<a href="https://fal.ai">
  <img alt="Powered by fal.ai" src="https://img.shields.io/badge/Powered%20by-fal.ai-000000?style=flat" />
</a>

## License

Released under the [MIT License](LICENSE).

---

<div align="center">

**RhymxCut is what happens when a video editor is treated as a real engineering system—not a demo.**

</div>
