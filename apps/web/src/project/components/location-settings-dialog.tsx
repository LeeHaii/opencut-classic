"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AiFolder01Icon,
	Folder01Icon,
	InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { isNative, nativeInvoke } from "@opencut/hyperframes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LocationSettings = {
	projectLocation: string;
	hyperframesLocation: string;
	defaultProjectLocation: string;
	defaultHyperframesLocation: string;
	restartRequired: boolean;
};

type LocationFieldProps = {
	id: string;
	label: string;
	description: string;
	value: string;
	defaultValue: string;
	disabled: boolean;
	icon: typeof Folder01Icon;
	onChange: (value: string) => void;
	onBrowse: () => void;
	onReset: () => void;
};

function LocationField({
	id,
	label,
	description,
	value,
	defaultValue,
	disabled,
	icon,
	onChange,
	onBrowse,
	onReset,
}: LocationFieldProps) {
	const isDefault = value === defaultValue;

	return (
		<div className="flex flex-col gap-2.5">
			<div className="flex items-start gap-3">
				<div className="bg-muted mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border">
					<HugeiconsIcon icon={icon} className="size-4" aria-hidden="true" />
				</div>
				<div className="min-w-0 flex-1">
					<Label htmlFor={id} className="text-sm font-medium">
						{label}
					</Label>
					<p className="text-muted-foreground mt-1 text-xs leading-relaxed">
						{description}
					</p>
				</div>
			</div>
			<div className="flex gap-2 pl-12">
				<Input
					id={id}
					value={value}
					disabled={disabled}
					spellCheck={false}
					className="font-mono text-xs"
					onChange={(event) => onChange(event.target.value)}
				/>
				<Button variant="outline" disabled={disabled} onClick={onBrowse}>
					Browse
				</Button>
			</div>
			<div className="flex min-h-5 items-center justify-between pl-12">
				<span className="text-muted-foreground truncate text-xs">
					Default: {defaultValue || "Available in the desktop app"}
				</span>
				{!isDefault && defaultValue && (
					<Button
						variant="link"
						className="ml-3 shrink-0 text-xs"
						disabled={disabled}
						onClick={onReset}
					>
						Use default
					</Button>
				)}
			</div>
		</div>
	);
}

export function LocationSettingsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const native = isNative();
	const [settings, setSettings] = useState<LocationSettings | null>(null);
	const [projectLocation, setProjectLocation] = useState("");
	const [hyperframesLocation, setHyperframesLocation] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!open || !native) return;

		let cancelled = false;
		void nativeInvoke<LocationSettings>("location_settings_get")
			.then((loaded) => {
				if (cancelled) return;
				setSettings(loaded);
				setProjectLocation(loaded.projectLocation);
				setHyperframesLocation(loaded.hyperframesLocation);
			})
			.catch((error) => {
				if (cancelled) return;
				toast.error("Could not load storage settings", {
					description: error instanceof Error ? error.message : String(error),
				});
			});

		return () => {
			cancelled = true;
		};
	}, [native, open]);

	const pickFolder = async ({
		title,
		onPick,
	}: {
		title: string;
		onPick: (path: string) => void;
	}) => {
		try {
			const selected = await nativeInvoke<string | null>(
				"location_pick_folder",
				{ title },
			);
			if (selected) onPick(selected);
		} catch (error) {
			toast.error("Could not open the folder picker", {
				description: error instanceof Error ? error.message : String(error),
			});
		}
	};

	const handleSave = async () => {
		if (!settings) return;
		setIsSaving(true);
		try {
			const saved = await nativeInvoke<LocationSettings>(
				"location_settings_save",
				{
					request: { projectLocation, hyperframesLocation },
				},
			);
			setSettings(saved);
			setProjectLocation(saved.projectLocation);
			setHyperframesLocation(saved.hyperframesLocation);
			toast.success("Storage locations saved", {
				description: saved.restartRequired
					? "Restart RhymxCut to use the new project location."
					: "HyperFrames and AI projects will use the new location immediately.",
			});
		} catch (error) {
			toast.error("Could not save storage locations", {
				description: error instanceof Error ? error.message : String(error),
			});
		} finally {
			setIsSaving(false);
		}
	};

	const disabled = !native || isSaving || !settings;
	const hasChanges =
		settings !== null &&
		(projectLocation !== settings.projectLocation ||
			hyperframesLocation !== settings.hyperframesLocation);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>Storage settings</DialogTitle>
					<DialogDescription>
						Choose where RhymxCut keeps editing projects and native AI assets.
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="gap-6">
					{!native && (
						<div className="bg-muted/50 flex gap-3 rounded-md border p-3 text-sm">
							<HugeiconsIcon
								icon={InformationCircleIcon}
								className="mt-0.5 size-4 shrink-0"
							/>
							<p>
								Folder locations are managed by the operating system and are
								only available in RhymxCut Desktop.
							</p>
						</div>
					)}

					<LocationField
						id="project-location"
						label="Project location"
						description="Stores project metadata and imported media in an EBWebView subfolder. A changed location takes effect after restarting RhymxCut. Existing projects are not moved automatically."
						value={projectLocation}
						defaultValue={settings?.defaultProjectLocation ?? ""}
						disabled={disabled}
						icon={Folder01Icon}
						onChange={setProjectLocation}
						onBrowse={() =>
							void pickFolder({
								title: "Choose RhymxCut project location",
								onPick: setProjectLocation,
							})
						}
						onReset={() =>
							setProjectLocation(settings?.defaultProjectLocation ?? "")
						}
					/>

					<div className="border-t" />

					<LocationField
						id="hyperframes-location"
						label="HyperFrames & AI project location"
						description="Stores generated compositions, Studio files, rendered scenes, reference images, and Antigravity agent workspaces."
						value={hyperframesLocation}
						defaultValue={settings?.defaultHyperframesLocation ?? ""}
						disabled={disabled}
						icon={AiFolder01Icon}
						onChange={setHyperframesLocation}
						onBrowse={() =>
							void pickFolder({
								title: "Choose HyperFrames and AI project location",
								onPick: setHyperframesLocation,
							})
						}
						onReset={() =>
							setHyperframesLocation(settings?.defaultHyperframesLocation ?? "")
						}
					/>

					{settings?.restartRequired && (
						<div className="border-caution/30 bg-caution/10 text-caution flex gap-3 rounded-md border p-3 text-sm">
							<HugeiconsIcon
								icon={InformationCircleIcon}
								className="mt-0.5 size-4 shrink-0"
							/>
							<p>Restart RhymxCut to activate the selected project location.</p>
						</div>
					)}
				</DialogBody>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Close
					</Button>
					<Button
						disabled={disabled || !hasChanges}
						onClick={() => void handleSave()}
					>
						{isSaving ? "Saving…" : "Save changes"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
