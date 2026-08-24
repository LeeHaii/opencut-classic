import type { EditorCore } from "@/core";
import { processMediaAssets } from "@/media/processing";
import type { HyperframesElement, TimelineTrack } from "@/timeline";
import {
	isNative,
	nativeInvoke,
	onHfRenderDone,
	onHfRenderError,
	onHfRenderProgress,
} from "@opencut/hyperframes";

export class HyperframesRenderCancelledError extends Error {
	constructor() {
		super("HyperFrames render cancelled");
		this.name = "HyperframesRenderCancelledError";
	}
}

export function hashHyperframesSource({ html }: { html: string }): string {
	let hash = 2166136261;
	for (let index = 0; index < html.length; index++) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function newJobId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);
}

function findElement({
	editor,
	elementId,
}: {
	editor: EditorCore;
	elementId: string;
}): { trackId: string; element: HyperframesElement } | null {
	const tracks = editor.scenes.getActiveSceneOrNull()?.tracks;
	if (!tracks) return null;
	const orderedTracks: TimelineTrack[] = [
		...tracks.overlay,
		tracks.main,
		...tracks.audio,
	];
	for (const track of orderedTracks) {
		const element = track.elements.find(
			(candidate): candidate is HyperframesElement =>
				candidate.id === elementId && candidate.type === "hyperframes",
		);
		if (element) return { trackId: track.id, element };
	}
	return null;
}

async function importRenderedClip({
	editor,
	elementId,
	expectedHash,
	mp4Path,
}: {
	editor: EditorCore;
	elementId: string;
	expectedHash: string;
	mp4Path: string;
}): Promise<string> {
	const located = findElement({ editor, elementId });
	if (!located) throw new Error("The AI scene was removed while it rendered.");
	if (hashHyperframesSource({ html: located.element.html }) !== expectedHash) {
		throw new Error("The AI scene changed while it rendered. Render it again.");
	}
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) throw new Error("No active project");

	const { readFile } = await import("@tauri-apps/plugin-fs");
	const bytes = await readFile(mp4Path);
	const file = new File([bytes], `${located.element.compositionId}.mp4`, {
		type: "video/mp4",
	});
	const [asset] = await processMediaAssets({ files: [file] });
	if (!asset) throw new Error("The rendered clip could not be imported.");
	asset.ephemeral = true;
	const added = await editor.media.addMediaAsset({ projectId, asset });
	if (!added) throw new Error("The rendered clip could not be added to the project.");

	editor.timeline.updateElements({
		updates: [
			{
				trackId: located.trackId,
				elementId,
				patch: {
					renderedMediaId: added.id,
					renderHash: expectedHash,
				},
			},
		],
	});
	return added.id;
}

export async function renderHyperframesElement({
	editor,
	elementId,
	onProgress,
	shouldCancel,
}: {
	editor: EditorCore;
	elementId: string;
	onProgress?: ({ message }: { message: string }) => void;
	shouldCancel?: () => boolean;
}): Promise<{ mediaId: string }> {
	if (!isNative()) {
		throw new Error("Rendering AI scenes requires the OpenCut desktop app.");
	}
	const located = findElement({ editor, elementId });
	if (!located) throw new Error("AI scene not found");
	const projectId = editor.project.getActiveOrNull()?.metadata.id;
	if (!projectId) throw new Error("No active project");

	const jobId = newJobId();
	const expectedHash = hashHyperframesSource({ html: located.element.html });
	let settled = false;
	let cancelInterval: ReturnType<typeof setInterval> | null = null;
	const unlisteners: Array<() => void> = [];

	const cleanup = () => {
		if (cancelInterval) clearInterval(cancelInterval);
		for (const unlisten of unlisteners) unlisten();
	};
	let resolveResult!: (result: { mediaId: string }) => void;
	let rejectResult!: (error: Error) => void;
	const resultPromise = new Promise<{ mediaId: string }>((resolve, reject) => {
		resolveResult = resolve;
		rejectResult = reject;
	});
	const fail = (error: unknown) => {
		if (settled) return;
		settled = true;
		cleanup();
		rejectResult(error instanceof Error ? error : new Error(String(error)));
	};
	const succeed = (result: { mediaId: string }) => {
		if (settled) return;
		settled = true;
		cleanup();
		resolveResult(result);
	};

	try {
		unlisteners.push(
			await onHfRenderProgress((payload) => {
				if (payload.jobId === jobId) {
					onProgress?.({ message: payload.chunk.slice(0, 140) });
				}
			}),
			await onHfRenderError((payload) => {
				if (payload.jobId === jobId) fail(new Error(payload.message));
			}),
			await onHfRenderDone((payload) => {
				if (payload.jobId !== jobId) return;
				void importRenderedClip({
					editor,
					elementId,
					expectedHash,
					mp4Path: payload.mp4Path,
				}).then((mediaId) => succeed({ mediaId }), fail);
			}),
		);

		if (shouldCancel) {
			cancelInterval = setInterval(() => {
				if (!settled && shouldCancel()) {
					void nativeInvoke("hf_render_cancel", { jobId });
					fail(new HyperframesRenderCancelledError());
				}
			}, 100);
		}

		onProgress?.({ message: "Starting renderer…" });
		await nativeInvoke("hf_render", {
			request: {
				jobId,
				projectId,
				elementId,
				html: located.element.html,
			},
		});
	} catch (error) {
		fail(error);
	}
	return resultPromise;
}
