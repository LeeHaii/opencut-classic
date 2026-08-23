# HyperFrames CLI resources

At packaging time, copy the installed CLI into this directory so the bundled
app can find it:

```powershell
# from apps/desktop, after `bun install`
Copy-Item -Recurse -Force ..\..\node_modules\hyperframes .\resources\hyperframes-cli\hyperframes
```

`resolve_hyperframes_cli()` looks for
`resources/hyperframes-cli/hyperframes/bin/hyperframes.mjs` next to the
executable. In dev builds the CLI is resolved from
`apps/desktop/node_modules/hyperframes` instead.
