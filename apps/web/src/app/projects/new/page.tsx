"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Film, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useEditor } from "@/editor/use-editor";

type ProjectMode = "blank" | "ai";

export default function NewProjectPage() {
	const editor = useEditor();
	const router = useRouter();
	const [pendingMode, setPendingMode] = useState<ProjectMode | null>(null);

	const createProject = async ({ mode }: { mode: ProjectMode }) => {
		if (pendingMode) return;
		setPendingMode(mode);
		try {
			const projectId = await editor.project.createNewProject({
				name: "New project",
			});
			router.push(
				mode === "blank"
					? `/editor/${projectId}`
					: `/projects/new/ai/${projectId}`,
			);
		} catch (error) {
			toast.error("Failed to create project", {
				description:
					error instanceof Error ? error.message : "Please try again",
			});
			setPendingMode(null);
		}
	};

	return (
		<main className="bg-background min-h-screen px-6 py-8">
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-12">
				<Button variant="ghost" className="w-fit" asChild>
					<Link href="/projects">
						<ArrowLeft className="size-4" />
						All projects
					</Link>
				</Button>

				<section className="flex flex-col gap-8 text-center">
					<div className="flex flex-col gap-3">
						<h1 className="text-4xl font-semibold tracking-tight">
							How do you want to start?
						</h1>
						<p className="text-muted-foreground text-base">
							Open an empty timeline or build a first cut from a voiceover.
						</p>
					</div>

					<div className="grid gap-5 text-left md:grid-cols-2">
						<ProjectModeCard
							title="Blank timeline"
							description="Start with the normal editor and build your timeline from scratch."
							icon={<Film className="size-6" />}
							buttonLabel="Open blank editor"
							isPending={pendingMode === "blank"}
							disabled={pendingMode !== null}
							onSelect={() => void createProject({ mode: "blank" })}
						/>
						<ProjectModeCard
							title="Generate with AI"
							description="Choose a voiceover file, review the visual plan, and generate a synchronized timeline."
							icon={<Sparkles className="size-6" />}
							buttonLabel="Generate timeline"
							isPending={pendingMode === "ai"}
							disabled={pendingMode !== null}
							onSelect={() => void createProject({ mode: "ai" })}
						/>
					</div>
				</section>
			</div>
		</main>
	);
}

function ProjectModeCard({
	title,
	description,
	icon,
	buttonLabel,
	isPending,
	disabled,
	onSelect,
}: {
	title: string;
	description: string;
	icon: React.ReactNode;
	buttonLabel: string;
	isPending: boolean;
	disabled: boolean;
	onSelect: () => void;
}) {
	return (
		<Card className="bg-background">
			<CardContent className="flex h-full flex-col gap-6 p-6">
				<div className="bg-muted text-foreground flex size-12 items-center justify-center rounded-lg">
					{icon}
				</div>
				<div className="flex flex-1 flex-col gap-2">
					<h2 className="text-xl font-medium">{title}</h2>
					<p className="text-muted-foreground text-sm leading-6">
						{description}
					</p>
				</div>
				<Button onClick={onSelect} disabled={disabled}>
					{isPending ? "Creating project…" : buttonLabel}
				</Button>
			</CardContent>
		</Card>
	);
}
