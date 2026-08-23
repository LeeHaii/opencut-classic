import { create } from "zustand";
import type { CaptionMode, PlanScene, RhymxApiKeys } from "../types";
import { loadApiKeys, saveApiKey } from "../settings";

export type RhymxWizardStep =
	| "idle"
	| "transcribing"
	| "planning"
	| "reviewing"
	| "matching"
	| "applying";

interface RhymxStore {
	step: RhymxWizardStep;
	error: string | null;
	statusMessage: string | null;
	progressDone: number;
	progressTotal: number;
	scenes: PlanScene[];
	fullNarration: string;
	keys: RhymxApiKeys;
	includeCaptions: boolean;
	captionMode: CaptionMode;

	setStep: ({ step }: { step: RhymxWizardStep }) => void;
	setError: ({ error }: { error: string | null }) => void;
	setStatusMessage: ({ message }: { message: string | null }) => void;
	setProgress: ({ done, total }: { done: number; total: number }) => void;
	setScenes: ({ scenes }: { scenes: PlanScene[] }) => void;
	updateScene: ({
		sceneId,
		patch,
	}: {
		sceneId: string;
		patch: Partial<PlanScene>;
	}) => void;
	setFullNarration: ({ narration }: { narration: string }) => void;
	reloadKeys: () => void;
	updateKey: ({ key, value }: { key: keyof RhymxApiKeys; value: string }) => void;
	setIncludeCaptions: ({ value }: { value: boolean }) => void;
	setCaptionMode: ({ mode }: { mode: CaptionMode }) => void;
	reset: () => void;
}

const INITIAL_KEYS = loadApiKeys();

export const useRhymxStore = create<RhymxStore>()((set) => ({
	step: "idle",
	error: null,
	statusMessage: null,
	progressDone: 0,
	progressTotal: 0,
	scenes: [],
	fullNarration: "",
	keys: INITIAL_KEYS,
	includeCaptions: true,
	captionMode: "phrase",

	setStep: ({ step }) => set({ step }),
	setError: ({ error }) =>
		set(error !== null ? { error, statusMessage: null } : { error: null }),
	setStatusMessage: ({ message }) =>
		set(
			message !== null
				? { statusMessage: message, error: null }
				: { statusMessage: null },
		),
	setProgress: ({ done, total }) => set({ progressDone: done, progressTotal: total }),
	setScenes: ({ scenes }) => set({ scenes }),
	updateScene: ({ sceneId, patch }) =>
		set((state) => ({
			scenes: state.scenes.map((scene) =>
				scene.id === sceneId ? { ...scene, ...patch } : scene,
			),
		})),
	setFullNarration: ({ narration }) => set({ fullNarration: narration }),
	reloadKeys: () => set({ keys: loadApiKeys() }),
	updateKey: ({ key, value }) => {
		saveApiKey({ key, value });
		set((state) => ({ keys: { ...state.keys, [key]: value.trim() } }));
	},
	setIncludeCaptions: ({ value }) => set({ includeCaptions: value }),
	setCaptionMode: ({ mode }) => set({ captionMode: mode }),
	reset: () =>
		set({
			step: "idle",
			error: null,
			statusMessage: null,
			progressDone: 0,
			progressTotal: 0,
			scenes: [],
			fullNarration: "",
		}),
}));
