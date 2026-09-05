"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { HyperframesElement } from "@/timeline";
import { hyperframesPreviewPresentationKey } from "./preview-selection";

/** Keep the actual outgoing document until canvas + incoming document can swap. */
export function usePreviewPresentation({
	desiredElement,
	scope,
}: {
	desiredElement: HyperframesElement | null;
	scope: string;
}) {
	const desiredKey = desiredElement
		? hyperframesPreviewPresentationKey(desiredElement)
		: null;
	const target = `${scope}:${desiredKey ?? "canvas"}`;
	const [preparation, setPreparation] = useState({ target, ready: false });
	const [presented, setPresented] = useState<{
		scope: string;
		element: HyperframesElement | null;
	}>({ scope, element: null });
	const committedRef = useRef(presented);
	// Reset synchronously on navigation, including A -> video -> A. A prior
	// document's readiness must not authorize a newly mounted iframe.
	if (preparation.target !== target) setPreparation({ target, ready: false });
	const ready = preparation.target === target && preparation.ready;
	const live = useRef({ target, desiredKey, desiredElement, scope, ready });
	useLayoutEffect(() => {
		live.current = { target, desiredKey, desiredElement, scope, ready };
	});
	const onReady = useCallback((key: string) => {
		if (key !== live.current.desiredKey) return;
		const currentTarget = live.current.target;
		setPreparation((current) =>
			current.target === currentTarget && !current.ready
				? { target: currentTarget, ready: true }
				: current,
		);
	}, []);
	const onCanvasCommitted = useCallback(
		(_time: number, committedTarget: string) => {
			const current = live.current;
			if (
				committedTarget !== current.target ||
				(current.desiredKey && !current.ready)
			)
				return;
			if (
				committedRef.current.scope === current.scope &&
				committedRef.current.element === current.desiredElement
			)
				return;
			committedRef.current = {
				scope: current.scope,
				element: current.desiredElement,
			};
			// Called only after a synchronous compositor commit (outside React's
			// lifecycle). Reveal/remove the overlay before the browser's next paint.
			flushSync(() =>
				setPresented((previous) =>
					previous.scope === current.scope &&
					previous.element === current.desiredElement
						? previous
						: { scope: current.scope, element: current.desiredElement },
				),
			);
		},
		[],
	);
	return {
		presentedElement: presented.scope === scope ? presented.element : null,
		canvasCommitSuspended: desiredKey !== null && !ready,
		canvasPresentationKey: target,
		onReady,
		onCanvasCommitted,
	};
}
