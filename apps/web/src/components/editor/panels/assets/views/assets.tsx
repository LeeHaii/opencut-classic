"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { MediaDragOverlay } from "@/components/editor/panels/assets/drag-overlay";
import { DraggableItem } from "@/components/editor/panels/assets/draggable-item";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { DEFAULT_NEW_ELEMENT_DURATION } from "@/timeline/creation";
import { mediaTimeFromSeconds, type MediaTime } from "@/wasm";
import { useEditor } from "@/editor/use-editor";
import { useFileUpload } from "@/media/use-file-upload";
import { invokeAction } from "@/actions";
import { processMediaAssets } from "@/media/processing";
import { showMediaUploadToast } from "@/media/upload-toast";
import {
	SelectableItem,
	SelectableSurface,
	useSelection,
	useSelectionScope,
} from "@/selection";
import { buildElementFromMedia } from "@/timeline/element-utils";
import {
	type MediaSortKey,
	type MediaSortOrder,
	type MediaViewMode,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { MASKABLE_ELEMENT_TYPES } from "@/timeline";
import type { MediaAsset } from "@/media/types";
import { ROOT_MEDIA_FOLDER_ID, type MediaFolder } from "@/media/types";
import {
	CreateMediaFolderCommand,
	DeleteMediaFolderCommand,
	MoveMediaAssetsCommand,
	MoveMediaFolderCommand,
	RenameMediaFolderCommand,
} from "@/commands";
import { cn } from "@/utils/ui";
import { ChevronRight, Folder, FolderPlus, House } from "lucide-react";
import {
	CloudUploadIcon,
	GridViewIcon,
	LeftToRightListDashIcon,
	SortingOneNineIcon,
	Image02Icon,
	MusicNote03Icon,
	Video01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

const MEDIA_FOLDER_DRAG_MIME = "application/x-opencut-media-folder";

export function MediaView() {
	const editor = useEditor();
	const mediaFiles = useEditor((e) => e.media.getAssets());
	const mediaFolders = useEditor((e) => e.media.getFolders());
	const activeProject = useEditor((e) => e.project.getActive());

	const {
		mediaViewMode,
		setMediaViewMode,
		highlightMediaId,
		clearHighlight,
		mediaSortBy,
		mediaSortOrder,
		setMediaSort,
		currentMediaFolderId,
		setCurrentMediaFolderId,
	} = useAssetsPanelStore();

	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState(0);
	const [createFolderDialog, setCreateFolderDialog] = useState({
		open: false,
		name: "",
	});
	const revealedAsset = highlightMediaId
		? mediaFiles.find((item) => item.id === highlightMediaId)
		: undefined;
	const displayedMediaFolderId = revealedAsset
		? (revealedAsset.folderId ?? ROOT_MEDIA_FOLDER_ID)
		: currentMediaFolderId;
	const mediaPageKey = `${displayedMediaFolderId}\u0000${mediaSortBy}\u0000${mediaSortOrder}`;
	const [mediaPage, setMediaPage] = useState({
		key: mediaPageKey,
		limit: 200,
	});
	const visibleMediaLimit =
		mediaPage.key === mediaPageKey ? mediaPage.limit : 200;

	useEffect(() => {
		if (
			currentMediaFolderId !== ROOT_MEDIA_FOLDER_ID &&
			!mediaFolders.some((folder) => folder.id === currentMediaFolderId)
		) {
			setCurrentMediaFolderId(ROOT_MEDIA_FOLDER_ID);
		}
	}, [currentMediaFolderId, mediaFolders, setCurrentMediaFolderId]);

	useEffect(() => {
		if (!highlightMediaId) return;
		const asset = mediaFiles.find((item) => item.id === highlightMediaId);
		if (asset) {
			setCurrentMediaFolderId(asset.folderId ?? ROOT_MEDIA_FOLDER_ID);
		}
	}, [highlightMediaId, mediaFiles, setCurrentMediaFolderId]);

	const processFiles = async ({ files }: { files: File[] }) => {
		if (!files || files.length === 0) return;
		if (!activeProject) {
			toast.error("No active project");
			return;
		}

		setIsProcessing(true);
		setProgress(0);
		try {
			await showMediaUploadToast({
				filesCount: files.length,
				promise: async () => {
					const processedAssets = await processMediaAssets({
						files,
						onProgress: (progress: { progress: number }) =>
							setProgress(progress.progress),
					});
					for (const asset of processedAssets) {
						await editor.media.addMediaAsset({
							projectId: activeProject.metadata.id,
							asset: { ...asset, folderId: displayedMediaFolderId },
						});
					}
					return {
						uploadedCount: processedAssets.length,
						assetNames: processedAssets.map((asset) => asset.name),
					};
				},
			});
		} catch (error) {
			console.error("Error processing files:", error);
		} finally {
			setIsProcessing(false);
			setProgress(0);
		}
	};

	const { isDragOver, dragProps, openFilePicker, fileInputProps } =
		useFileUpload({
			accept: "image/*,video/*,audio/*",
			multiple: true,
			onFilesSelected: (files) => processFiles({ files }),
		});

	const handleRemove = ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => {
		event.stopPropagation();

		invokeAction("remove-media-assets", {
			projectId: activeProject.metadata.id,
			assetIds: ids,
		});
	};

	const handleSort = ({ key }: { key: MediaSortKey }) => {
		if (mediaSortBy === key) {
			setMediaSort({
				key,
				order: mediaSortOrder === "asc" ? "desc" : "asc",
			});
		} else {
			setMediaSort({ key, order: "asc" });
		}
	};

	const filteredMediaItems = useMemo(() => {
		const filtered = mediaFiles.filter(
			(item) =>
				!item.ephemeral &&
				(item.folderId ?? ROOT_MEDIA_FOLDER_ID) === displayedMediaFolderId,
		);

		filtered.sort((a, b) => {
			let valueA: string | number;
			let valueB: string | number;

			switch (mediaSortBy) {
				case "name":
					valueA = a.name.toLowerCase();
					valueB = b.name.toLowerCase();
					break;
				case "type":
					valueA = a.type;
					valueB = b.type;
					break;
				case "duration":
					valueA = a.duration || 0;
					valueB = b.duration || 0;
					break;
				case "size":
					valueA = a.file?.size ?? 0;
					valueB = b.file?.size ?? 0;
					break;
				default:
					return 0;
			}

			if (valueA < valueB) return mediaSortOrder === "asc" ? -1 : 1;
			if (valueA > valueB) return mediaSortOrder === "asc" ? 1 : -1;
			return 0;
		});

		return filtered;
	}, [displayedMediaFolderId, mediaFiles, mediaSortBy, mediaSortOrder]);
	const childFolders = useMemo(
		() =>
			mediaFolders
				.filter((folder) => folder.parentId === displayedMediaFolderId)
				.sort((a, b) => a.name.localeCompare(b.name)),
		[displayedMediaFolderId, mediaFolders],
	);
	const highlightedIndex = highlightMediaId
		? filteredMediaItems.findIndex((item) => item.id === highlightMediaId)
		: -1;
	const effectiveVisibleMediaLimit =
		highlightedIndex >= 0
			? Math.max(
					visibleMediaLimit,
					Math.ceil((highlightedIndex + 1) / 200) * 200,
				)
			: visibleMediaLimit;
	const visibleMediaItems = useMemo(
		() => filteredMediaItems.slice(0, effectiveVisibleMediaLimit),
		[effectiveVisibleMediaLimit, filteredMediaItems],
	);
	const breadcrumbs = useMemo(() => {
		const byId = new Map(mediaFolders.map((folder) => [folder.id, folder]));
		const result: MediaFolder[] = [];
		const visited = new Set<string>();
		let cursor = displayedMediaFolderId;
		while (cursor !== ROOT_MEDIA_FOLDER_ID && !visited.has(cursor)) {
			visited.add(cursor);
			const folder = byId.get(cursor);
			if (!folder) break;
			result.unshift(folder);
			cursor = folder.parentId;
		}
		return result;
	}, [displayedMediaFolderId, mediaFolders]);
	const orderedMediaIds = useMemo(() => {
		return filteredMediaItems.map((item) => item.id);
	}, [filteredMediaItems]);

	const createFolder = ({ name }: { name: string }) => {
		editor.command.execute({
			command: new CreateMediaFolderCommand({
				projectId: activeProject.metadata.id,
				parentId: displayedMediaFolderId,
				name,
			}),
		});
		setCreateFolderDialog({ open: false, name: "" });
	};

	return (
		<>
			<input {...fileInputProps} />
			<CreateMediaFolderDialog
				open={createFolderDialog.open}
				name={createFolderDialog.name}
				existingNames={childFolders.map((folder) => folder.name)}
				onNameChange={(name) =>
					setCreateFolderDialog((dialog) => ({ ...dialog, name }))
				}
				onOpenChange={(open) => setCreateFolderDialog({ open, name: "" })}
				onCreate={createFolder}
			/>

			<PanelView
				title="Assets"
				actions={
					<MediaActions
						mediaViewMode={mediaViewMode}
						setMediaViewMode={setMediaViewMode}
						isProcessing={isProcessing}
						sortBy={mediaSortBy}
						sortOrder={mediaSortOrder}
						onSort={handleSort}
						onImport={openFilePicker}
						onCreateFolder={() =>
							setCreateFolderDialog({ open: true, name: "" })
						}
					/>
				}
				className={cn(isDragOver && "bg-accent/30")}
				contentClassName="h-full"
				{...dragProps}
			>
				<SelectableSurface
					ariaLabel="Assets"
					orderedIds={orderedMediaIds}
					revealId={highlightMediaId}
					onRevealComplete={clearHighlight}
				>
					<MediaScopeRegistrar />
					<MediaBreadcrumbs
						folders={breadcrumbs}
						projectId={activeProject.metadata.id}
						onNavigate={setCurrentMediaFolderId}
					/>
					{isDragOver ||
					(filteredMediaItems.length === 0 && childFolders.length === 0) ? (
						<MediaDragOverlay
							isVisible={true}
							isProcessing={isProcessing}
							progress={progress}
							onClick={openFilePicker}
						/>
					) : (
						<>
							<MediaFolderList
								folders={childFolders}
								projectId={activeProject.metadata.id}
								onOpen={setCurrentMediaFolderId}
							/>
							<MediaItemList
								items={visibleMediaItems}
								mode={mediaViewMode}
								onRemove={handleRemove}
							/>
							{visibleMediaItems.length < filteredMediaItems.length && (
								<Button
									variant="ghost"
									size="sm"
									className="mt-3 w-full"
									onClick={() =>
										setMediaPage({
											key: mediaPageKey,
											limit: visibleMediaLimit + 200,
										})
									}
								>
									Show 200 more (
									{filteredMediaItems.length - visibleMediaItems.length}{" "}
									remaining)
								</Button>
							)}
						</>
					)}
				</SelectableSurface>
			</PanelView>
		</>
	);
}

function CreateMediaFolderDialog({
	open,
	name,
	existingNames,
	onOpenChange,
	onNameChange,
	onCreate,
}: {
	open: boolean;
	name: string;
	existingNames: string[];
	onOpenChange: (open: boolean) => void;
	onNameChange: (name: string) => void;
	onCreate: (args: { name: string }) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const trimmedName = name.trim();
	const isDuplicate = existingNames.some(
		(existingName) =>
			existingName.localeCompare(trimmedName, undefined, {
				sensitivity: "accent",
			}) === 0,
	);
	const errorMessage = isDuplicate
		? "A folder with that name already exists here."
		: null;
	const canCreate = trimmedName.length > 0 && !isDuplicate;

	const submit = () => {
		if (!canCreate) return;
		onCreate({ name: trimmedName });
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="max-w-sm"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					inputRef.current?.focus();
				}}
			>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						submit();
					}}
				>
					<DialogHeader>
						<DialogTitle>Create folder</DialogTitle>
					</DialogHeader>
					<DialogBody className="gap-2">
						<Label htmlFor="media-folder-name">Folder name</Label>
						<Input
							ref={inputRef}
							id="media-folder-name"
							value={name}
							onChange={(event) => onNameChange(event.target.value)}
							placeholder="Enter a folder name"
							maxLength={80}
							aria-invalid={isDuplicate}
							aria-describedby={
								errorMessage ? "media-folder-name-error" : undefined
							}
						/>
						{errorMessage && (
							<p
								id="media-folder-name-error"
								className="text-destructive text-xs"
							>
								{errorMessage}
							</p>
						)}
					</DialogBody>
					<DialogFooter>
						<Button variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={!canCreate}>
							Create
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function MediaScopeRegistrar() {
	useSelectionScope();
	return null;
}

function useMoveDraggedMedia({
	projectId,
	folderId,
}: {
	projectId: string;
	folderId: string;
}) {
	const editor = useEditor();
	const { selectedIds } = useSelection();
	return (event: React.DragEvent) => {
		const active = editor.timeline.dragSource.getActive();
		if (active?.type !== "media" || !active.id) return false;
		event.preventDefault();
		event.stopPropagation();
		const assetIds = selectedIds.includes(active.id)
			? selectedIds
			: [active.id];
		editor.command.execute({
			command: new MoveMediaAssetsCommand({ projectId, assetIds, folderId }),
		});
		return true;
	};
}

function MediaBreadcrumbDropTarget({
	label,
	folderId,
	projectId,
	onNavigate,
	icon,
}: {
	label: string;
	folderId: string;
	projectId: string;
	onNavigate: (folderId: string) => void;
	icon?: React.ReactNode;
}) {
	const editor = useEditor();
	const moveDraggedMedia = useMoveDraggedMedia({ projectId, folderId });
	return (
		<button
			type="button"
			className="hover:bg-muted flex min-w-0 items-center gap-1 rounded px-1.5 py-1"
			onClick={() => onNavigate(folderId)}
			onDragOver={(event) => {
				if (
					event.dataTransfer.types.includes("application/x-timeline-drag") ||
					event.dataTransfer.types.includes(MEDIA_FOLDER_DRAG_MIME)
				) {
					event.preventDefault();
					event.dataTransfer.dropEffect = "move";
				}
			}}
			onDrop={(event) => {
				if (moveDraggedMedia(event)) return;
				const draggedFolderId = event.dataTransfer.getData(
					MEDIA_FOLDER_DRAG_MIME,
				);
				if (!draggedFolderId) return;
				event.preventDefault();
				event.stopPropagation();
				editor.command.execute({
					command: new MoveMediaFolderCommand({
						projectId,
						folderId: draggedFolderId,
						parentId: folderId,
					}),
				});
			}}
		>
			{icon}
			<span className="max-w-28 truncate">{label}</span>
		</button>
	);
}

function MediaBreadcrumbs({
	folders,
	projectId,
	onNavigate,
}: {
	folders: MediaFolder[];
	projectId: string;
	onNavigate: (folderId: string) => void;
}) {
	return (
		<nav
			aria-label="Media folders"
			className="text-muted-foreground mb-2 flex min-h-7 items-center gap-0.5 overflow-x-auto text-[11px]"
		>
			<MediaBreadcrumbDropTarget
				label="Media"
				folderId={ROOT_MEDIA_FOLDER_ID}
				projectId={projectId}
				onNavigate={onNavigate}
				icon={<House className="size-3" />}
			/>
			{folders.map((folder) => (
				<div className="flex items-center" key={folder.id}>
					<ChevronRight className="size-3 shrink-0" />
					<MediaBreadcrumbDropTarget
						label={folder.name}
						folderId={folder.id}
						projectId={projectId}
						onNavigate={onNavigate}
					/>
				</div>
			))}
		</nav>
	);
}

function MediaFolderList({
	folders,
	projectId,
	onOpen,
}: {
	folders: MediaFolder[];
	projectId: string;
	onOpen: (folderId: string) => void;
}) {
	if (folders.length === 0) return null;
	return (
		<div
			className="mb-3 grid gap-2"
			style={{ gridTemplateColumns: "repeat(auto-fill, 7rem)" }}
		>
			{folders.map((folder) => (
				<MediaFolderCard
					key={folder.id}
					folder={folder}
					projectId={projectId}
					onOpen={onOpen}
				/>
			))}
		</div>
	);
}

function MediaFolderCard({
	folder,
	projectId,
	onOpen,
}: {
	folder: MediaFolder;
	projectId: string;
	onOpen: (folderId: string) => void;
}) {
	const editor = useEditor();
	const moveDraggedMedia = useMoveDraggedMedia({
		projectId,
		folderId: folder.id,
	});
	const rename = () => {
		const name = window.prompt("Rename folder", folder.name)?.trim();
		if (!name || name === folder.name) return;
		editor.command.execute({
			command: new RenameMediaFolderCommand({
				projectId,
				folderId: folder.id,
				name,
			}),
		});
	};
	const remove = () => {
		if (
			editor.media.getChildFolders({ parentId: folder.id }).length > 0 ||
			editor.media.getAssetsInFolder({ folderId: folder.id }).length > 0
		) {
			toast.error("Only empty folders can be deleted");
			return;
		}
		editor.command.execute({
			command: new DeleteMediaFolderCommand({ projectId, folderId: folder.id }),
		});
	};
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<button
					type="button"
					draggable
					className="hover:bg-muted/70 flex h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-md border bg-muted/25 px-2 text-center transition-colors"
					style={{ contentVisibility: "auto", containIntrinsicSize: "80px" }}
					onClick={() => onOpen(folder.id)}
					onDragStart={(event) => {
						event.dataTransfer.setData(MEDIA_FOLDER_DRAG_MIME, folder.id);
						event.dataTransfer.effectAllowed = "move";
					}}
					onDragOver={(event) => {
						if (
							event.dataTransfer.types.includes(
								"application/x-timeline-drag",
							) ||
							event.dataTransfer.types.includes(MEDIA_FOLDER_DRAG_MIME)
						) {
							event.preventDefault();
							event.dataTransfer.dropEffect = "move";
						}
					}}
					onDrop={(event) => {
						if (moveDraggedMedia(event)) return;
						const draggedFolderId = event.dataTransfer.getData(
							MEDIA_FOLDER_DRAG_MIME,
						);
						if (!draggedFolderId) return;
						event.preventDefault();
						event.stopPropagation();
						editor.command.execute({
							command: new MoveMediaFolderCommand({
								projectId,
								folderId: draggedFolderId,
								parentId: folder.id,
							}),
						});
					}}
				>
					<Folder className="size-7 text-amber-500" fill="currentColor" />
					<span className="w-full truncate text-[11px]">{folder.name}</span>
				</button>
			</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={() => onOpen(folder.id)}>
					Open
				</ContextMenuItem>
				<ContextMenuItem onClick={rename}>Rename</ContextMenuItem>
				<ContextMenuItem variant="destructive" onClick={remove}>
					Delete empty folder
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaAssetDraggable({
	item,
	preview,
	variant,
	isRounded,
}: {
	item: MediaAsset;
	preview: React.ReactNode;
	variant: "card" | "compact";
	isRounded?: boolean;
}) {
	const editor = useEditor();

	const addElementAtTime = ({
		asset,
		startTime,
	}: {
		asset: MediaAsset;
		startTime: MediaTime;
	}) => {
		const duration =
			asset.duration != null
				? mediaTimeFromSeconds({ seconds: asset.duration })
				: DEFAULT_NEW_ELEMENT_DURATION;
		const element = buildElementFromMedia({
			mediaId: asset.id,
			mediaType: asset.type,
			name: asset.name,
			duration,
			startTime,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
	};

	return (
		<DraggableItem
			name={item.name}
			preview={preview}
			onDragStart={({ e }) => {
				// Timeline drops copy media into a scene; folder drops move the catalog item.
				e.dataTransfer.effectAllowed = "copyMove";
			}}
			dragData={{
				id: item.id,
				type: "media",
				mediaType: item.type,
				name: item.name,
				targetElementTypes:
					item.type === "audio" ? ["audio"] : [...MASKABLE_ELEMENT_TYPES],
			}}
			shouldShowPlusOnDrag={false}
			onAddToTimeline={({ currentTime }) =>
				addElementAtTime({ asset: item, startTime: currentTime })
			}
			variant={variant}
			isRounded={isRounded}
		/>
	);
}

function MediaItemWithContextMenu({
	item,
	children,
	onRemove,
}: {
	item: MediaAsset;
	children: React.ReactNode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const editor = useEditor();
	const { isSelected, selectedIds } = useSelection();
	const idsToDelete = isSelected(item.id) ? selectedIds : [item.id];
	const deleteLabel =
		idsToDelete.length > 1 ? `Delete ${idsToDelete.length} items` : "Delete";

	const handleDownloadOffline = (asset: MediaAsset) => {
		const projectId = editor.project.getActiveOrNull()?.metadata.id;
		if (!projectId) return;
		toast.promise(
			editor.media.downloadRemoteAsset({ projectId, id: asset.id }),
			{
				loading: "Downloading for offline use…",
				success: "Saved to project media",
				error: (error) =>
					error instanceof Error ? error.message : "Download failed",
			},
		);
	};

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent>
				{item.remoteUrl && !item.file && (
					<ContextMenuItem onClick={() => handleDownloadOffline(item)}>
						Download for offline
					</ContextMenuItem>
				)}
				<ContextMenuItem>Export clips</ContextMenuItem>
				<ContextMenuItem
					variant="destructive"
					onClick={(event: React.MouseEvent<HTMLDivElement>) =>
						onRemove({ event, ids: idsToDelete })
					}
				>
					{deleteLabel}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function MediaItemList({
	items,
	mode,
	onRemove,
}: {
	items: MediaAsset[];
	mode: MediaViewMode;
	onRemove: ({
		event,
		ids,
	}: {
		event: React.MouseEvent;
		ids: string[];
	}) => void;
}) {
	const isGrid = mode === "grid";

	return (
		<div
			className={cn(isGrid ? "grid gap-4" : "flex flex-col gap-1.5")}
			style={
				isGrid ? { gridTemplateColumns: "repeat(auto-fill, 7rem)" } : undefined
			}
		>
			{items.map((item) => (
				<MediaItemWithContextMenu item={item} onRemove={onRemove} key={item.id}>
					<SelectableItem
						className={cn(!isGrid && "w-full")}
						id={item.id}
						style={{
							contentVisibility: "auto",
							containIntrinsicSize: isGrid ? "112px 96px" : "48px",
						}}
					>
						<MediaAssetDraggable
							item={item}
							preview={
								<MediaPreview
									item={item}
									variant={isGrid ? "grid" : "compact"}
								/>
							}
							variant={isGrid ? "card" : "compact"}
							isRounded={isGrid ? false : undefined}
						/>
					</SelectableItem>
				</MediaItemWithContextMenu>
			))}
		</div>
	);
}

function formatDuration({ duration }: { duration: number }) {
	const min = Math.floor(duration / 60);
	const sec = Math.floor(duration % 60);
	return `${min}:${sec.toString().padStart(2, "0")}`;
}

function MediaDurationBadge({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<div className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-xs text-white">
			{formatDuration({ duration })}
		</div>
	);
}

function MediaDurationLabel({ duration }: { duration?: number }) {
	if (!duration) return null;

	return (
		<span className="text-xs opacity-70">{formatDuration({ duration })}</span>
	);
}

function MediaTypePlaceholder({
	icon,
	label,
	duration,
	variant,
}: {
	icon: IconSvgElement;
	label: string;
	duration?: number;
	variant: "muted" | "bordered";
}) {
	const iconClassName = cn("size-6", variant === "bordered" && "mb-1");

	return (
		<div
			className={cn(
				"text-muted-foreground flex size-full flex-col items-center justify-center rounded",
				variant === "muted" ? "bg-muted/30" : "border",
			)}
		>
			<HugeiconsIcon icon={icon} className={iconClassName} />
			<span className="text-xs">{label}</span>
			<MediaDurationLabel duration={duration} />
		</div>
	);
}

function MediaPreview({
	item,
	variant = "grid",
}: {
	item: MediaAsset;
	variant?: "grid" | "compact";
}) {
	const shouldShowDurationBadge = variant === "grid";

	if (item.type === "image") {
		return (
			<div className="relative flex size-full items-center justify-center bg-muted">
				<Image
					src={item.url ?? ""}
					alt={item.name}
					fill
					sizes="100vw"
					className="object-cover"
					loading="lazy"
					unoptimized
				/>
			</div>
		);
	}

	if (item.type === "video") {
		if (item.thumbnailUrl) {
			return (
				<div className="relative size-full">
					<Image
						src={item.thumbnailUrl}
						alt={item.name}
						fill
						sizes="100vw"
						className="rounded object-cover"
						loading="lazy"
						unoptimized
					/>
					{shouldShowDurationBadge ? (
						<MediaDurationBadge duration={item.duration} />
					) : null}
				</div>
			);
		}

		return (
			<MediaTypePlaceholder
				icon={Video01Icon}
				label="Video"
				duration={item.duration}
				variant="muted"
			/>
		);
	}

	if (item.type === "audio") {
		return (
			<MediaTypePlaceholder
				icon={MusicNote03Icon}
				label="Audio"
				duration={item.duration}
				variant="bordered"
			/>
		);
	}

	return (
		<MediaTypePlaceholder icon={Image02Icon} label="Unknown" variant="muted" />
	);
}

function MediaActions({
	mediaViewMode,
	setMediaViewMode,
	isProcessing,
	sortBy,
	sortOrder,
	onSort,
	onImport,
	onCreateFolder,
}: {
	mediaViewMode: MediaViewMode;
	setMediaViewMode: (mode: MediaViewMode) => void;
	isProcessing: boolean;
	sortBy: MediaSortKey;
	sortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
	onImport: () => void;
	onCreateFolder: () => void;
}) {
	return (
		<div className="flex gap-1.5">
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							size="icon"
							variant="ghost"
							onClick={() =>
								setMediaViewMode(mediaViewMode === "grid" ? "list" : "grid")
							}
							disabled={isProcessing}
							className="items-center justify-center"
						>
							{mediaViewMode === "grid" ? (
								<HugeiconsIcon icon={LeftToRightListDashIcon} />
							) : (
								<HugeiconsIcon icon={GridViewIcon} />
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						<p>
							{mediaViewMode === "grid"
								? "Switch to list view"
								: "Switch to grid view"}
						</p>
					</TooltipContent>
				</Tooltip>
				<Tooltip>
					<DropdownMenu>
						<TooltipTrigger asChild>
							<DropdownMenuTrigger asChild>
								<Button
									size="icon"
									variant="ghost"
									disabled={isProcessing}
									className="items-center justify-center"
								>
									<HugeiconsIcon icon={SortingOneNineIcon} />
								</Button>
							</DropdownMenuTrigger>
						</TooltipTrigger>
						<DropdownMenuContent align="end">
							<SortMenuItem
								label="Name"
								sortKey="name"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Type"
								sortKey="type"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="Duration"
								sortKey="duration"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
							<SortMenuItem
								label="File size"
								sortKey="size"
								currentSortBy={sortBy}
								currentSortOrder={sortOrder}
								onSort={onSort}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
					<TooltipContent>
						<p>
							Sort by {sortBy} (
							{sortOrder === "asc" ? "ascending" : "descending"})
						</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
			<Button
				variant="ghost"
				size="icon"
				disabled={isProcessing}
				onClick={onCreateFolder}
				aria-label="Create media folder"
			>
				<FolderPlus className="size-4" />
			</Button>
			<Button
				variant="outline"
				onClick={onImport}
				disabled={isProcessing}
				size="sm"
				className="items-center justify-center gap-1.5"
			>
				<HugeiconsIcon icon={CloudUploadIcon} />
				Import
			</Button>
		</div>
	);
}

function SortMenuItem({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: MediaSortKey;
	currentSortBy: MediaSortKey;
	currentSortOrder: MediaSortOrder;
	onSort: ({ key }: { key: MediaSortKey }) => void;
}) {
	const isActive = currentSortBy === sortKey;
	const arrow = isActive ? (currentSortOrder === "asc" ? "↑" : "↓") : "";

	return (
		<DropdownMenuItem onClick={() => onSort({ key: sortKey })}>
			{label} {arrow}
		</DropdownMenuItem>
	);
}
