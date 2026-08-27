import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const tauriCli = require.resolve("@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
	cwd: desktopDirectory,
	stdio: "inherit",
	windowsHide: true,
});

child.once("error", (error) => {
	console.error(`Failed to start the Tauri CLI: ${error.message}`);
	process.exitCode = 1;
});

child.once("exit", (code, signal) => {
	if (signal) {
		console.error(`Tauri exited after signal ${signal}`);
		process.exitCode = 1;
		return;
	}
	process.exitCode = code ?? 1;
});
