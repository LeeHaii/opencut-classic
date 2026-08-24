# OpenCut Desktop

This is the functional Tauri v2 desktop shell. It opens the Next.js editor in
WebView2 and provides the native HyperFrames, Antigravity, render, and Studio
commands.

From the repository root, run this command. It bypasses package-manager shims,
so it also works on machines whose global npm/bun launcher is misconfigured:

```powershell
node apps/desktop/script/tauri.mjs dev
```

`bun run desktop:dev` and `npm run desktop:dev` are convenience aliases.

The Tauri development command starts the web editor on
`http://localhost:3000`, waits for it to become available, and then opens the
desktop window. Do not use `cargo run -p opencut-desktop-gpui` unless you are
working on the unfinished GPUI shell; that target currently contains only a
placeholder screen.

To create a release build:

```powershell
node apps/desktop/script/tauri.mjs build
```

Release builds load `https://www.opencut.pro` by default. Set
`OPENCUT_DESKTOP_URL` before launching the executable to point it at a different
editor deployment.
