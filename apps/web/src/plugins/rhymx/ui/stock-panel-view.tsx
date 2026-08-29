"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { useAssetsPanelStore } from "@/components/editor/panels/assets/assets-panel-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { useEditor } from "@/editor/use-editor";
import { searchStockMedia } from "@/plugins/rhymx/scenes/stock-search";
import { MediaAcquirer } from "@/plugins/rhymx/scenes/acquirer";
import { loadApiKeys } from "@/plugins/rhymx/settings";
import { useRhymxStore } from "@/plugins/rhymx/state/rhymx-store";
import type { StockCandidate } from "@/plugins/rhymx/types";
import { MASKABLE_ELEMENT_TYPES } from "@/timeline";
import type { MediaDragData } from "@/timeline/drag";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { mediaTimeFromSeconds } from "@/wasm";
import { AlertTriangle, Play, Search } from "lucide-react";
import { toast } from "sonner";

const PROVIDER_LABELS: Record<string, string> = {
	pexels: "Pexels",
	pixabay: "Pixabay",
};

const MAX_RESULTS = 40;

interface StockEntry {
	dragData: MediaDragData;
	status: "idle" | "acquiring" | "ready" | "failed";
	acquisition?: Promise<void>;
}

export function StockPanelView() {
	const editor = useEditor();
	const [query, setQuery] = useState("");
	const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">(
		"idle",
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [results, setResults] = useState<StockCandidate[]>([]);
	const [activeQuery, setActiveQuery] = useState("");
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [entries, setEntries] = useState<Map<string, StockEntry>>(
		() => new Map(),
	);
	const setPreviewCandidate = useRhymxStore(
		(state) => state.setPreviewCandidate,
	);
	const acquirerRef = useRef<MediaAcquirer | null>(null);
	if (acquirerRef.current == null) {
		acquirerRef.current = new MediaAcquirer();
	}
	const searchAbortRef = useRef<AbortController | null>(null);

	useEffect(
		() => () => {
			searchAbortRef.current?.abort();
		},
		[],
	);

	const keys = loadApiKeys();
	const availableProviders = useMemo(
		() => [
			...(keys.pexels ? (["pexels"] as const) : []),
			...(keys.pixabay ? (["pixabay"] as const) : []),
		],
		[keys.pexels, keys.pixabay],
	);

	const resolveForTimeline = useCallback(
		({
			candidate,
			entry,
		}: {
			candidate: StockCandidate;
			entry: StockEntry;
		}): MediaDragData => {
			if (entry.status === "ready" && entry.dragData.id) {
				return entry.dragData;
			}
			if (entry.status === "acquiring" && entry.dragData.id) {
				return entry.dragData;
			}

			const started = acquirerRef.current?.startAcquisition({
				editor,
				candidate,
			});
			if (!started) throw new Error("Download failed");
			entry.dragData = { ...entry.dragData, id: started.mediaId };
			entry.status = "acquiring";
			setEntries((current) =>
				current.get(candidate.id) === entry ? new Map(current) : current,
			);

			entry.acquisition = started.acquisition
				.then((acquired) => {
					entry.dragData = { ...entry.dragData, id: acquired.mediaId };
					entry.status = "ready";
				})
				.catch((error: unknown) => {
					entry.status = "failed";
					toast.error("Couldn't download stock video", {
						description:
							error instanceof Error ? error.message : "Download failed",
					});
				})
				.finally(() => {
					entry.acquisition = undefined;
					setEntries((current) =>
						current.get(candidate.id) === entry ? new Map(current) : current,
					);
				});
			return entry.dragData;
		},
		[editor],
	);

	const searchPage = useCallback(
		async ({
			searchQuery,
			pageNumber,
			append,
		}: {
			searchQuery: string;
			pageNumber: number;
			append: boolean;
		}) => {
			if (!searchQuery || availableProviders.length === 0) return;

			searchAbortRef.current?.abort();
			const controller = new AbortController();
			searchAbortRef.current = controller;

			if (append) {
				setIsLoadingMore(true);
			} else {
				setIsLoadingMore(false);
				setStatus("searching");
				setResults([]);
				setEntries(new Map());
				setHasMore(false);
				setPreviewCandidate({ candidate: null });
			}
			setErrorMessage(null);

			try {
				const { candidates } = await searchStockMedia({
					query: {
						query: searchQuery,
						providers: [...availableProviders],
						kind: "video",
						page: pageNumber,
					},
					context: {
						pexelsKey: keys.pexels,
						pixabayKey: keys.pixabay,
						signal: controller.signal,
					},
				});
				if (controller.signal.aborted) return;

				const priorResults = append ? results : [];
				const knownIds = new Set(priorResults.map((candidate) => candidate.id));
				const nextPage = interleaveByProvider(candidates).filter(
					(candidate) => !knownIds.has(candidate.id),
				);
				const merged = [...priorResults, ...nextPage].slice(0, MAX_RESULTS);
				const nextEntries = append
					? new Map(entries)
					: new Map<string, StockEntry>();
				for (const candidate of nextPage) {
					if (nextEntries.has(candidate.id)) continue;
					nextEntries.set(candidate.id, {
						dragData: {
							id: "",
							type: "media",
							mediaType: "video",
							name: clipName(candidate),
							duration: candidate.durationSec,
							targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
						},
						status: "idle",
					});
				}

				setResults(merged);
				setEntries(nextEntries);
				setActiveQuery(searchQuery);
				setPage(pageNumber);
				setHasMore(nextPage.length > 0 && merged.length < MAX_RESULTS);
				setStatus("done");
			} catch (error) {
				if (controller.signal.aborted) return;
				const message =
					error instanceof Error ? error.message : "Stock search failed";
				if (append) {
					toast.error("Couldn't load more stock videos", {
						description: message,
					});
				} else {
					setStatus("error");
					setErrorMessage(message);
				}
			} finally {
				if (!controller.signal.aborted) setIsLoadingMore(false);
			}
		},
		[
			availableProviders,
			entries,
			keys.pexels,
			keys.pixabay,
			results,
			setPreviewCandidate,
		],
	);

	const runSearch = useCallback(async () => {
		const trimmed = query.trim();
		if (!trimmed) return;
		await searchPage({ searchQuery: trimmed, pageNumber: 1, append: false });
	}, [query, searchPage]);

	const loadMore = useCallback(async () => {
		if (!activeQuery || isLoadingMore || !hasMore) return;
		await searchPage({
			searchQuery: activeQuery,
			pageNumber: page + 1,
			append: true,
		});
	}, [activeQuery, hasMore, isLoadingMore, page, searchPage]);

	const addToTimeline = useCallback(
		({
			candidate,
			mediaId,
		}: {
			candidate: StockCandidate;
			mediaId: string;
		}) => {
			editor.timeline.insertElement({
				element: buildElementFromMedia({
					mediaId,
					mediaType: "video",
					name: clipName(candidate),
					duration:
						candidate.durationSec && candidate.durationSec > 0
							? mediaTimeFromSeconds({ seconds: candidate.durationSec })
							: DEFAULT_NEW_ELEMENT_DURATION,
					startTime: editor.playback.getCurrentTime(),
				}),
				placement: { mode: "auto" },
			});
		},
		[editor],
	);

	const addCandidateToTimeline = useCallback(
		({
			candidate,
			entry,
		}: {
			candidate: StockCandidate;
			entry: StockEntry;
		}) => {
			const dragData = resolveForTimeline({ candidate, entry });
			addToTimeline({ candidate, mediaId: dragData.id });
		},
		[addToTimeline, resolveForTimeline],
	);

	return (
		<PanelView title="Stock videos" contentClassName="h-full">
			<div className="flex min-h-full flex-col gap-2 pb-4">
				<form
					className="flex w-full flex-col gap-1.5"
					onSubmit={(event) => {
						event.preventDefault();
						void runSearch();
					}}
				>
					<Input
						size="xs"
						className="w-full"
						value={query}
						placeholder="Search Pexels + Pixabay…"
						spellCheck={false}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<Button
						type="submit"
						size="sm"
						className="h-8 w-full px-2.5"
						disabled={
							status === "searching" ||
							query.trim().length === 0 ||
							availableProviders.length === 0
						}
						onClick={() => void runSearch()}
					>
						{status === "searching" ? (
							<Spinner className="size-3.5" />
						) : (
							<Search className="size-3.5" />
						)}
						Search
					</Button>
				</form>

				<p className="text-muted-foreground px-0.5 text-[10px] leading-relaxed">
					Click a clip to preview it. The full video downloads only when you add
					it to the timeline.
				</p>

				{availableProviders.length === 0 && (
					<div className="border-border/60 bg-muted/30 text-muted-foreground flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed">
						<AlertTriangle className="text-primary mt-px size-3 shrink-0" />
						<p>
							Add a Pexels or Pixabay API key to search.{" "}
							<button
								type="button"
								className="text-foreground underline underline-offset-2"
								onClick={() =>
									useAssetsPanelStore.getState().setActiveTab("ai")
								}
							>
								Set keys in the AI panel
							</button>
						</p>
					</div>
				)}

				{status === "error" && errorMessage && (
					<div className="border-destructive/25 bg-destructive/8 text-destructive flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[10px] leading-relaxed">
						<AlertTriangle className="mt-px size-3 shrink-0" />
						<span>{errorMessage}</span>
					</div>
				)}

				{status === "done" && results.length === 0 && (
					<div className="border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed px-3 py-4 text-center text-[10px]">
						No videos matched that search.
					</div>
				)}

				<div className="grid grid-cols-2 gap-2">
					{results.map((candidate) => {
						const entry = entries.get(candidate.id);
						return (
							<DraggableItem
								key={candidate.id}
								name={
									candidate.creator
										? `${candidate.creator} · ${formatDuration(candidate.durationSec)}`
										: formatDuration(candidate.durationSec)
								}
								variant="card"
								containerClassName="w-full"
								shouldShowPlusOnDrag={false}
								isDraggable={Boolean(entry && entry.status !== "acquiring")}
								dragData={entry?.dragData ?? FALLBACK_DRAG_DATA}
								resolveDragData={
									entry
										? () => resolveForTimeline({ candidate, entry })
										: undefined
								}
								onAddToTimeline={
									entry
										? () => void addCandidateToTimeline({ candidate, entry })
										: undefined
								}
								onPreview={() => setPreviewCandidate({ candidate })}
								preview={
									<>
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={candidate.thumbnailUrl ?? candidate.previewUrl}
											alt={`${PROVIDER_LABELS[candidate.provider] ?? candidate.provider} stock video${candidate.creator ? ` by ${candidate.creator}` : ""}`}
											loading="lazy"
											draggable={false}
											referrerPolicy="no-referrer"
											className="size-full object-cover transition-transform group-hover:scale-[1.02]"
											title={`${PROVIDER_LABELS[candidate.provider] ?? candidate.provider}${candidate.creator ? ` · ${candidate.creator}` : ""} · ${candidate.licenseName}`}
										/>
										<span className="bg-background/80 text-foreground absolute top-1 left-1 rounded px-1 text-[8px] font-medium tracking-wide uppercase">
											{PROVIDER_LABELS[candidate.provider] ??
												candidate.provider}
										</span>
										<span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
											<span className="rounded-full bg-black/60 p-1.5 text-white">
												<Play className="size-3 fill-current" />
											</span>
										</span>
										{entry?.status === "acquiring" && (
											<span className="bg-black/35 absolute inset-0 flex items-center justify-center">
												<Spinner className="size-4 text-white drop-shadow" />
											</span>
										)}
										{entry?.status === "failed" && (
											<span className="pointer-events-none absolute top-1 right-1 rounded-full bg-background/85 p-1">
												<AlertTriangle className="size-3 text-destructive" />
											</span>
										)}
									</>
								}
							/>
						);
					})}
				</div>

				{status === "done" && results.length > 0 && hasMore && (
					<Button
						variant="outline"
						className="mt-1 h-8 w-full"
						disabled={isLoadingMore}
						onClick={() => void loadMore()}
					>
						{isLoadingMore && <Spinner className="size-3.5" />}
						{isLoadingMore ? "Loading more…" : "Load more"}
					</Button>
				)}
			</div>
		</PanelView>
	);
}

const FALLBACK_DRAG_DATA: MediaDragData = {
	id: "",
	type: "media",
	mediaType: "video",
	name: "Stock clip",
	targetElementTypes: [...MASKABLE_ELEMENT_TYPES],
};

function clipName(candidate: StockCandidate): string {
	return candidate.creator
		? `${candidate.creator} · stock clip`
		: `Stock clip · ${PROVIDER_LABELS[candidate.provider] ?? candidate.provider}`;
}

function interleaveByProvider(candidates: StockCandidate[]): StockCandidate[] {
	const queues = new Map<string, StockCandidate[]>();
	for (const candidate of candidates) {
		const queue = queues.get(candidate.provider) ?? [];
		queue.push(candidate);
		queues.set(candidate.provider, queue);
	}
	const merged: StockCandidate[] = [];
	while (merged.length < candidates.length) {
		for (const queue of queues.values()) {
			const next = queue.shift();
			if (next) merged.push(next);
		}
	}
	return merged;
}

function formatDuration(durationSec?: number): string {
	if (!durationSec || durationSec <= 0) return "clip";
	const seconds = Math.round(durationSec);
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
