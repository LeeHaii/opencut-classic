import {
	PARENT_MESSAGE_SOURCE,
	PREVIEW_MESSAGE_SOURCE,
	preparePreviewHtml,
} from "@opencut/hyperframes";
import type { HyperframesNodeParams } from "@/services/renderer/nodes/hyperframes-node";

interface SnapshotMessage {
	source?: string;
	type?: string;
	requestId?: string;
	xhtml?: string;
	message?: string;
}

interface PendingSnapshot {
	resolve: (xhtml: string) => void;
	reject: (error: Error) => void;
	timeout: ReturnType<typeof setTimeout>;
}

interface BrowserFrame {
	source: HTMLCanvasElement;
	width: number;
	height: number;
}

const sessions = new Map<string, BrowserHyperframesSession>();

function sourceHash({ html }: { html: string }): string {
	let hash = 2166136261;
	for (let index = 0; index < html.length; index++) {
		hash ^= html.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(36);
}

function sessionKey({ params }: { params: HyperframesNodeParams }): string {
	return `${params.compositionId}:${sourceHash({ html: params.html })}:${params.width}x${params.height}`;
}

function newRequestId(): string {
	return typeof crypto !== "undefined" && "randomUUID" in crypto
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);
}

class BrowserHyperframesSession {
	private readonly iframe: HTMLIFrameElement;
	private readonly pending = new Map<string, PendingSnapshot>();
	private readonly ready: Promise<void>;
	private resolveReady!: () => void;
	private rejectReady!: (error: Error) => void;
	private readyTimeout: ReturnType<typeof setTimeout>;
	private disposed = false;

	constructor(private readonly params: HyperframesNodeParams) {
		this.ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.iframe = document.createElement("iframe");
		this.iframe.title = `HyperFrames export renderer: ${params.compositionId}`;
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.referrerPolicy = "no-referrer";
		this.iframe.style.position = "fixed";
		this.iframe.style.left = "-100000px";
		this.iframe.style.top = "0";
		this.iframe.style.width = `${params.width}px`;
		this.iframe.style.height = `${params.height}px`;
		this.iframe.style.pointerEvents = "none";
		this.iframe.style.opacity = "0.001";
		this.iframe.srcdoc = preparePreviewHtml(params.html);
		window.addEventListener("message", this.handleMessage);
		document.body.appendChild(this.iframe);
		this.readyTimeout = setTimeout(() => {
			this.rejectReady(
				new Error(
					`Browser renderer timed out loading ${params.compositionId}. Check external scripts and the HyperFrames timeline registration.`,
				),
			);
		}, 15_000);
	}

	private handleMessage = (event: MessageEvent<SnapshotMessage>) => {
		if (event.source !== this.iframe.contentWindow) return;
		if (event.data?.source !== PREVIEW_MESSAGE_SOURCE) return;
		if (event.data.type === "ready") {
			clearTimeout(this.readyTimeout);
			this.resolveReady();
			return;
		}
		if (event.data.type === "error") {
			clearTimeout(this.readyTimeout);
			this.rejectReady(
				new Error(
					event.data.message ?? "HyperFrames browser renderer failed to start.",
				),
			);
			return;
		}
		const requestId = event.data.requestId;
		if (!requestId) return;
		const pending = this.pending.get(requestId);
		if (!pending) return;
		clearTimeout(pending.timeout);
		this.pending.delete(requestId);
		if (event.data.type === "snapshot" && event.data.xhtml) {
			pending.resolve(event.data.xhtml);
		} else if (event.data.type === "snapshot-error") {
			pending.reject(
				new Error(event.data.message ?? "HyperFrames snapshot failed."),
			);
		}
	};

	async render({
		timeSeconds,
	}: {
		timeSeconds: number;
	}): Promise<BrowserFrame> {
		if (this.disposed)
			throw new Error("HyperFrames browser renderer was disposed");
		await this.ready;
		const requestId = newRequestId();
		const xhtmlPromise = new Promise<string>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error("HyperFrames frame snapshot timed out."));
			}, 10_000);
			this.pending.set(requestId, { resolve, reject, timeout });
		});
		this.iframe.contentWindow?.postMessage(
			{
				source: PARENT_MESSAGE_SOURCE,
				type: "control",
				action: "snapshot",
				requestId,
				timeSeconds,
			},
			"*",
		);
		const xhtml = await xhtmlPromise;
		return rasterizeXhtml({
			xhtml,
			width: this.params.width,
			height: this.params.height,
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		clearTimeout(this.readyTimeout);
		window.removeEventListener("message", this.handleMessage);
		this.iframe.remove();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("HyperFrames browser renderer was disposed"));
		}
		this.pending.clear();
	}
}

async function rasterizeXhtml({
	xhtml,
	width,
	height,
}: {
	xhtml: string;
	width: number;
	height: number;
}): Promise<BrowserFrame> {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
	try {
		const image = new Image();
		image.decoding = "sync";
		// A data URL keeps the SVG origin-clean when its XHTML foreignObject is
		// copied into the compositor's OffscreenCanvas. Chromium can treat the
		// equivalent blob URL as an external resource and reject the WebGPU upload.
		image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (!context) throw new Error("2D canvas is unavailable");
		context.drawImage(image, 0, 0, width, height);
		return { source: canvas, width, height };
	} catch (error) {
		throw new Error(
			`The browser could not rasterize a HyperFrames frame: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function renderHyperframesBrowserFrame({
	params,
	timeSeconds,
}: {
	params: HyperframesNodeParams;
	timeSeconds: number;
}): Promise<BrowserFrame> {
	const key = sessionKey({ params });
	let session = sessions.get(key);
	if (!session) {
		session = new BrowserHyperframesSession(params);
		sessions.set(key, session);
	}
	return session.render({ timeSeconds });
}

export function disposeBrowserHyperframesSessions(): void {
	for (const session of sessions.values()) session.dispose();
	sessions.clear();
}
