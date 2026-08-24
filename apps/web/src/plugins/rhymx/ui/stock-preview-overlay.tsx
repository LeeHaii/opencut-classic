"use client";

import { X } from "lucide-react";
import type { PreviewOverlaySourceResult } from "@/preview/overlays";
import { Button } from "@/components/ui/button";
import { useRhymxStore } from "../state/rhymx-store";
import type { StockCandidate } from "../types";

const OVERLAY_ID = "rhymx-stock-preview";

/**
 * Renders the clicked stock candidate on the main preview screen as a
 * single streaming <video>/<img> overlay — no download, no renderer work.
 */
export function getStockPreviewOverlaySource({
	candidate,
}: {
	candidate: StockCandidate;
}): PreviewOverlaySourceResult {
	return {
		definitions: [
			{ id: OVERLAY_ID, label: "Stock media preview", defaultVisible: true },
		],
		instances: [
			{
				id: `${OVERLAY_ID}-instance`,
				mount: { kind: "scene" },
				plane: "over-interaction",
				pointerEvents: "auto",
				zIndex: 60,
				render: () => <StockPreviewOverlay candidate={candidate} />,
			},
		],
	};
}

function StockPreviewOverlay({ candidate }: { candidate: StockCandidate }) {
	const setPreviewCandidate = useRhymxStore(
		(state) => state.setPreviewCandidate,
	);
	const src = candidate.previewUrl ?? candidate.sourceUrl;

	return (
		<div className="relative size-full overflow-hidden bg-black">
			{candidate.kind === "video" ? (
				// eslint-disable-next-line jsx-a11y/media-has-caption -- stock preview clip, no captions available
				<video
					key={src}
					src={src}
					className="size-full object-contain"
					autoPlay
					loop
					controls
					playsInline
					preload="metadata"
				/>
			) : (
				<img
					src={src}
					alt={candidate.id}
					className="size-full object-contain"
					referrerPolicy="no-referrer"
				/>
			)}
			<div className="pointer-events-none absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1.5">
				<span className="rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
					Preview · {candidate.provider}
					{candidate.creator ? ` · ${candidate.creator}` : ""}
				</span>
			</div>
			<Button
				variant="secondary"
				size="sm"
				className="absolute right-2 top-2 h-6 rounded px-2 text-[10px]"
				onClick={() => setPreviewCandidate({ candidate: null })}
			>
				<X className="size-3" />
				Exit preview
			</Button>
		</div>
	);
}
