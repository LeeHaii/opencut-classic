"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useEditor } from "@/editor/use-editor";
import type { MediaTime } from "@/wasm";

export function usePlaybackTime(): MediaTime {
	const editor = useEditor();
	const subscribe = useCallback(
		(onChange: () => void) => {
			const unsubscribeState = editor.playback.subscribe(onChange);
			const unsubscribeUpdate = editor.playback.onUpdate(onChange);
			const unsubscribeSeek = editor.playback.onSeek(onChange);
			return () => {
				unsubscribeState();
				unsubscribeUpdate();
				unsubscribeSeek();
			};
		},
		[editor],
	);
	const getSnapshot = useCallback(
		() => editor.playback.getCurrentTime(),
		[editor],
	);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
