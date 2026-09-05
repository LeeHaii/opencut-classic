import { Command } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { ROOT_MEDIA_FOLDER_ID, type MediaFolder } from "@/media/types";
import { generateUUID } from "@/utils/id";

export class CreateMediaFolderCommand extends Command {
	private readonly folder: MediaFolder;

	constructor({
		projectId,
		parentId,
		name,
	}: {
		projectId: string;
		parentId: string;
		name: string;
	}) {
		super();
		this.projectId = projectId;
		const now = Date.now();
		this.folder = {
			id: generateUUID(),
			parentId,
			name: name.trim(),
			createdAt: now,
			updatedAt: now,
		};
	}

	private readonly projectId: string;

	execute() {
		EditorCore.getInstance().media.addFolder({
			projectId: this.projectId,
			folder: this.folder,
		});
		return undefined;
	}

	undo() {
		EditorCore.getInstance().media.deleteFolder({
			projectId: this.projectId,
			folderId: this.folder.id,
		});
	}
}

export class RenameMediaFolderCommand extends Command {
	private previousName: string | null = null;

	constructor({
		projectId,
		folderId,
		name,
	}: {
		projectId: string;
		folderId: string;
		name: string;
	}) {
		super();
		this.projectId = projectId;
		this.folderId = folderId;
		this.name = name.trim();
	}

	private readonly projectId: string;
	private readonly folderId: string;
	private readonly name: string;

	execute() {
		const media = EditorCore.getInstance().media;
		this.previousName ??= media.getFolder({ id: this.folderId })?.name ?? null;
		media.renameFolder({
			projectId: this.projectId,
			folderId: this.folderId,
			name: this.name,
		});
		return undefined;
	}

	undo() {
		if (!this.previousName) return;
		EditorCore.getInstance().media.renameFolder({
			projectId: this.projectId,
			folderId: this.folderId,
			name: this.previousName,
		});
	}
}

export class MoveMediaAssetsCommand extends Command {
	private previousFolders: Map<string, string> | null = null;

	constructor({
		projectId,
		assetIds,
		folderId,
	}: {
		projectId: string;
		assetIds: string[];
		folderId: string;
	}) {
		super();
		this.projectId = projectId;
		this.assetIds = [...new Set(assetIds)];
		this.folderId = folderId;
	}

	private readonly projectId: string;
	private readonly assetIds: string[];
	private readonly folderId: string;

	execute() {
		const media = EditorCore.getInstance().media;
		if (!this.previousFolders) {
			this.previousFolders = new Map(
				this.assetIds.flatMap((id) => {
					const asset = media.getAsset({ id });
					return asset ? [[id, asset.folderId ?? ROOT_MEDIA_FOLDER_ID]] : [];
				}),
			);
		}
		media.moveAssetsToFolder({
			projectId: this.projectId,
			assetIds: this.assetIds,
			folderId: this.folderId,
		});
		return undefined;
	}

	undo() {
		if (!this.previousFolders) return;
		const media = EditorCore.getInstance().media;
		const byFolder = new Map<string, string[]>();
		for (const [assetId, folderId] of this.previousFolders) {
			byFolder.set(folderId, [...(byFolder.get(folderId) ?? []), assetId]);
		}
		for (const [folderId, assetIds] of byFolder) {
			media.moveAssetsToFolder({
				projectId: this.projectId,
				assetIds,
				folderId,
			});
		}
	}
}

export class DeleteMediaFolderCommand extends Command {
	private folder: MediaFolder | null = null;

	constructor({
		projectId,
		folderId,
	}: {
		projectId: string;
		folderId: string;
	}) {
		super();
		this.projectId = projectId;
		this.folderId = folderId;
	}

	private readonly projectId: string;
	private readonly folderId: string;

	execute() {
		const media = EditorCore.getInstance().media;
		this.folder ??= media.getFolder({ id: this.folderId });
		media.deleteFolder({ projectId: this.projectId, folderId: this.folderId });
		return undefined;
	}

	undo() {
		if (!this.folder) return;
		EditorCore.getInstance().media.addFolder({
			projectId: this.projectId,
			folder: this.folder,
		});
	}
}

export class MoveMediaFolderCommand extends Command {
	private previousParentId: string | null = null;

	constructor({
		projectId,
		folderId,
		parentId,
	}: {
		projectId: string;
		folderId: string;
		parentId: string;
	}) {
		super();
		this.projectId = projectId;
		this.folderId = folderId;
		this.parentId = parentId;
	}

	private readonly projectId: string;
	private readonly folderId: string;
	private readonly parentId: string;

	execute() {
		const media = EditorCore.getInstance().media;
		this.previousParentId ??=
			media.getFolder({ id: this.folderId })?.parentId ?? null;
		media.moveFolder({
			projectId: this.projectId,
			folderId: this.folderId,
			parentId: this.parentId,
		});
		return undefined;
	}

	undo() {
		if (!this.previousParentId) return;
		EditorCore.getInstance().media.moveFolder({
			projectId: this.projectId,
			folderId: this.folderId,
			parentId: this.previousParentId,
		});
	}
}
