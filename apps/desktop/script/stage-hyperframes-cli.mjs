import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceDirectory = resolve(desktopDirectory, "../..");
const installedModules = join(workspaceDirectory, "node_modules");
const resourceRoot = join(desktopDirectory, "resources", "hyperframes-cli");
const stagedModules = join(resourceRoot, "node_modules");
const verifyOnly = process.argv.includes("--verify");

if (
	!isAbsolute(stagedModules) ||
	relative(resourceRoot, stagedModules).startsWith("..")
) {
	throw new Error(
		"Refusing to stage outside the HyperFrames resource directory",
	);
}

if (!verifyOnly) {
	await rm(stagedModules, { recursive: true, force: true });
	await mkdir(stagedModules, { recursive: true });
}

const pending = [{ name: "hyperframes", optional: false }];
const copied = new Set();

while (pending.length > 0) {
	const next = pending.shift();
	if (!next || copied.has(next.name)) continue;
	const packageName = next.name;
	const source = join(installedModules, ...packageName.split("/"));
	const manifestPath = join(source, "package.json");
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		if (!next.optional) {
			throw new Error(
				`Required HyperFrames package ${packageName} is not installed at ${source}. Install workspace dependencies before building Desktop.`,
				{ cause: error },
			);
		}
		console.warn(`Skipping unavailable optional dependency ${packageName}`);
		continue;
	}

	if (!verifyOnly) {
		const destination = join(stagedModules, ...packageName.split("/"));
		await mkdir(dirname(destination), { recursive: true });
		await cp(source, destination, { recursive: true, dereference: true });
	}
	copied.add(packageName);

	for (const dependency of Object.keys(manifest.dependencies ?? {})) {
		if (!copied.has(dependency)) {
			pending.push({ name: dependency, optional: false });
		}
	}
	for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
		if (!copied.has(dependency)) {
			pending.push({ name: dependency, optional: true });
		}
	}
}

console.log(
	`${verifyOnly ? "Verified" : "Staged"} HyperFrames CLI with ${copied.size} production packages.`,
);
