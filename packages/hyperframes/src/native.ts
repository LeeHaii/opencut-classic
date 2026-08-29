/**
 * Capability gate + thin typed wrappers around the Tauri IPC bridge.
 * Everything degrades gracefully when running in a plain browser.
 */

type UnlistenFn = () => void;

interface TauriInternals {
	invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

declare global {
	interface Window {
		__TAURI_INTERNALS__?: TauriInternals;
	}
}

export function isNative(): boolean {
	return typeof window !== "undefined" && window.__TAURI_INTERNALS__ != null;
}

export async function nativeInvoke<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	if (!isNative()) {
		throw new Error(
			`native command "${command}" is unavailable in the browser`,
		);
	}
	const { invoke } = await import("@tauri-apps/api/core");
	return invoke<T>(command, args);
}

export async function nativeListen<T>(
	event: string,
	handler: (payload: T) => void,
): Promise<UnlistenFn> {
	if (!isNative()) {
		return () => {};
	}
	const { listen } = await import("@tauri-apps/api/event");
	return listen<T>(event, (e) => handler(e.payload));
}

// --- Command payloads ------------------------------------------------------

export interface AgentRunRequest {
	requestId: string;
	projectId: string;
	prompt: string;
	conversationId?: string;
	model?: string;
	/** Reference images as data URLs; the desktop layer stages them into the workspace. */
	images?: string[];
}

export interface AgentDonePayload {
	requestId: string;
	text: string;
	conversationId?: string;
	usage?: unknown;
	fallbackText: boolean;
	error?: string | null;
}

export interface AgentChunkPayload {
	requestId: string;
	stream: "stdout" | "stderr";
	chunk: string;
}

export interface WebImageCandidate {
	id: string;
	title: string;
	thumbnailUrl: string;
	sourceUrl: string;
	sourcePageUrl: string;
	width: number;
	height: number;
	mimeType: string;
	author: string;
	license: string;
	attribution: string;
}

export interface WebImageSearchResult {
	searchId: string;
	query: string;
	candidates: WebImageCandidate[];
}

export interface WebImageAsset {
	id: string;
	name: string;
	dataUrl: string;
	internalUrl: string;
	placeholder: string;
	sourcePageUrl: string;
	width: number;
	height: number;
	mimeType: string;
	author: string;
	license: string;
	attribution: string;
	sha256: string;
}

export interface HfRenderRequest {
	jobId: string;
	projectId: string;
	elementId: string;
	html: string;
	mediaBase?: string;
}

export interface StudioOpenRequest {
	projectId: string;
	elementId: string;
	html: string;
	compositionId?: string;
	width?: number;
	height?: number;
	durationSecs?: number;
}

export interface StudioOpenResult {
	url: string;
	port: number;
	dir: string;
}

export interface StudioHtmlChangedPayload {
	projectId: string;
	elementId: string;
	html: string;
}

export interface StudioAppendResult {
	masterHtml: string;
	childFileName: string;
	totalDurationSecs: number;
}

// --- Event subscriptions ---------------------------------------------------

const onAntigravityChunk = (handler: (p: AgentChunkPayload) => void) =>
	nativeListen<AgentChunkPayload>("antigravity-chunk", handler);
const onAntigravityDone = (handler: (p: AgentDonePayload) => void) =>
	nativeListen<AgentDonePayload>("antigravity-done", handler);
const onAntigravityError = (
	handler: (p: { requestId: string; message: string }) => void,
) =>
	nativeListen<{ requestId: string; message: string }>(
		"antigravity-error",
		handler,
	);

const onHfRenderProgress = (
	handler: (p: { jobId: string; elementId: string; chunk: string }) => void,
) =>
	nativeListen<{ jobId: string; elementId: string; chunk: string }>(
		"hf-render-progress",
		handler,
	);
const onHfRenderDone = (
	handler: (p: { jobId: string; elementId: string; mp4Path: string }) => void,
) =>
	nativeListen<{ jobId: string; elementId: string; mp4Path: string }>(
		"hf-render-done",
		handler,
	);
const onHfRenderError = (
	handler: (p: { jobId: string; elementId?: string; message: string }) => void,
) =>
	nativeListen<{ jobId: string; elementId?: string; message: string }>(
		"hf-render-error",
		handler,
	);

const onStudioHtmlChanged = (handler: (p: StudioHtmlChangedPayload) => void) =>
	nativeListen<StudioHtmlChangedPayload>("studio-html-changed", handler);

export {
	onAntigravityChunk,
	onAntigravityDone,
	onAntigravityError,
	onHfRenderProgress,
	onHfRenderDone,
	onHfRenderError,
	onStudioHtmlChanged,
};
