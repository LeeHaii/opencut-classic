# HyperFrames CLI resources

At packaging time, `script/stage-hyperframes-cli.mjs` copies the installed CLI
and its production dependency closure into this directory. Tauri then bundles
that self-contained Node dependency tree as `hyperframes-cli` resources.

```powershell
node script/stage-hyperframes-cli.mjs
```

`resolve_hyperframes_cli()` looks for
`$RESOURCE/hyperframes-cli/node_modules/hyperframes/bin/hyperframes.mjs`. In
workspace development the resolver also supports Bun/npm-hoisted dependencies
from the repository-level `node_modules`.
