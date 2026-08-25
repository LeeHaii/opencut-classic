"use client";

import { create } from "zustand";

interface HyperframesStudioState {
	/** Timeline element currently open in the in-app Scene Studio. */
	activeElementId: string | null;
	enter: ({ elementId }: { elementId: string }) => void;
	exit: () => void;
}

/**
 * Scene Studio focus mode: when active, the preview renders the target
 * HyperFrames element full-canvas (regardless of playhead position) and the
 * assets panel switches to the Studio tab for source/clip editing.
 */
export const useHyperframesStudioStore = create<HyperframesStudioState>()(
	(set) => ({
		activeElementId: null,
		enter: ({ elementId }) => set({ activeElementId: elementId }),
		exit: () => set({ activeElementId: null }),
	}),
);
