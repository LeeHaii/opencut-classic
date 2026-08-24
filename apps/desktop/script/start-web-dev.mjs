import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const webDirectory = resolve(desktopDirectory, "../web");
const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const editorUrl = "http://localhost:3000";

function editorPortIsInUse() {
	return new Promise((resolvePortCheck) => {
		const socket = connect({ host: "127.0.0.1", port: 3000 });
		const finish = (inUse) => {
			socket.destroy();
			resolvePortCheck(inUse);
		};
		socket.setTimeout(1_500);
		socket.once("connect", () => finish(true));
		socket.once("timeout", () => finish(false));
		socket.once("error", () => finish(false));
	});
}

if (await editorPortIsInUse()) {
	console.log(`Using the editor already running at ${editorUrl}`);
	process.exit(0);
}

const child = spawn(
	process.execPath,
	[nextCli, "dev", webDirectory, "--port", "3000"],
	{
		cwd: webDirectory,
		stdio: "inherit",
		windowsHide: true,
	},
);

child.once("error", (error) => {
	console.error(`Failed to start the OpenCut web editor: ${error.message}`);
	process.exitCode = 1;
});

child.once("exit", (code, signal) => {
	if (signal) {
		process.exitCode = 0;
		return;
	}
	process.exitCode = code ?? 1;
});
