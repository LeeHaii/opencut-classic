"use client";

import { create } from "zustand";
import type {
	AgentChatMessage,
	AntigravityStatus,
	WebImageAsset,
} from "@opencut/hyperframes";

export type AgentRunState = {
	running: boolean;
	requestId?: string;
	streamLine?: string;
	selectedImage?: Pick<WebImageAsset, "placeholder" | "internalUrl">;
};

interface HyperframesPanelState {
	/** Chat history per timeline element id. */
	chats: Record<string, AgentChatMessage[]>;
	/** Per-element run state (only one run per element at a time). */
	runs: Record<string, AgentRunState>;
	status: AntigravityStatus | null;
	models: string[];
	model: string;
	appendChat: (args: { elementId: string; message: AgentChatMessage }) => void;
	clearChat: (args: { elementId: string }) => void;
	setRun: (args: { elementId: string; run: AgentRunState }) => void;
	setStatus: (status: AntigravityStatus | null) => void;
	setModels: (models: string[]) => void;
	setModel: (model: string) => void;
}

export const useHyperframesPanelStore = create<HyperframesPanelState>()(
	(set) => ({
		chats: {},
		runs: {},
		status: null,
		models: [],
		model: "",
		appendChat: ({ elementId, message }) =>
			set((state) => {
				const existing = state.chats[elementId] ?? [];
				return {
					chats: {
						...state.chats,
						[elementId]: [...existing.slice(-98), message],
					},
				};
			}),
		clearChat: ({ elementId }) =>
			set((state) => ({
				chats: { ...state.chats, [elementId]: [] },
			})),
		setRun: ({ elementId, run }) =>
			set((state) => ({ runs: { ...state.runs, [elementId]: run } })),
		setStatus: (status) => set({ status }),
		setModels: (models) => set({ models }),
		setModel: (model) => set({ model }),
	}),
);
