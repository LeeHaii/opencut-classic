"use client";

import { create } from "zustand";

import type {
	StudioPreviewSelection,
	StudioTool,
	StudioWorkspaceView,
} from "./studio-document";

interface HyperframesStudioState {
	/** Timeline element currently open in the in-app Scene Studio. */
	activeElementId: string | null;
	sessionEpoch: number;
	selectedLayerKey: string | null;
	selectedLayerSelector: string | null;
	previewSelection: StudioPreviewSelection | null;
	previewIframe: HTMLIFrameElement | null;
	tool: StudioTool;
	workspaceView: StudioWorkspaceView;
	localTimeSeconds: number;
	enter: ({ elementId }: { elementId: string }) => void;
	exit: () => void;
	selectLayer: ({
		key,
		selector,
	}: {
		key: string | null;
		selector?: string | null;
	}) => void;
	setPreviewSelection: (selection: StudioPreviewSelection | null) => void;
	setPreviewIframe: (iframe: HTMLIFrameElement | null) => void;
	setTool: (tool: StudioTool) => void;
	setWorkspaceView: (view: StudioWorkspaceView) => void;
	setLocalTimeSeconds: (seconds: number) => void;
}

/**
 * Scene Studio focus mode: when active, the preview renders the target
 * HyperFrames element full-canvas (regardless of playhead position) and the
 * assets panel switches to the Studio tab for source/clip editing.
 */
export const useHyperframesStudioStore = create<HyperframesStudioState>()(
	(set) => ({
		activeElementId: null,
		sessionEpoch: 0,
		selectedLayerKey: null,
		selectedLayerSelector: null,
		previewSelection: null,
		previewIframe: null,
		tool: "select",
		workspaceView: "layers",
		localTimeSeconds: 0,
		enter: ({ elementId }) =>
			set((state) => ({
				activeElementId: elementId,
				sessionEpoch: state.sessionEpoch + 1,
				selectedLayerKey: null,
				selectedLayerSelector: null,
				previewSelection: null,
				previewIframe: null,
				tool: "select",
				workspaceView: "layers",
				localTimeSeconds: 0,
			})),
		exit: () =>
			set({
				activeElementId: null,
				selectedLayerKey: null,
				selectedLayerSelector: null,
				previewSelection: null,
				previewIframe: null,
				tool: "select",
				workspaceView: "layers",
				localTimeSeconds: 0,
			}),
		selectLayer: ({ key, selector }) =>
			set((state) => ({
				selectedLayerKey: key,
				selectedLayerSelector: key ? (selector ?? null) : null,
				previewSelection:
					state.previewSelection?.key === key ? state.previewSelection : null,
			})),
		setPreviewSelection: (selection) =>
			set({
				previewSelection: selection,
				selectedLayerKey: selection?.key ?? null,
				selectedLayerSelector: selection?.selector ?? null,
			}),
		setPreviewIframe: (iframe) => set({ previewIframe: iframe }),
		setTool: (tool) => set({ tool }),
		setWorkspaceView: (workspaceView) => set({ workspaceView }),
		setLocalTimeSeconds: (seconds) =>
			set({
				localTimeSeconds: Math.max(0, Number.isFinite(seconds) ? seconds : 0),
			}),
	}),
);
