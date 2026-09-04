"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorProvider } from "@/components/providers/editor-provider";
import { AiGeneratorView } from "@/plugins/rhymx/ui/ai-panel-view";
import { useRhymxStore } from "@/plugins/rhymx/state/rhymx-store";
import { StockPreviewOverlay } from "@/plugins/rhymx/ui/stock-preview-overlay";

export default function AiProjectPage() {
	const params = useParams();
	const projectIdParam = params.project_id;
	const projectId = Array.isArray(projectIdParam)
		? (projectIdParam[0] ?? "")
		: (projectIdParam ?? "");

	return (
		<EditorProvider projectId={projectId}>
			<AiProjectLayout projectId={projectId} />
		</EditorProvider>
	);
}

function AiProjectLayout({ projectId }: { projectId: string }) {
	const router = useRouter();
	const previewCandidate = useRhymxStore((state) => state.previewCandidate);

	return (
		<main className="bg-muted/20 flex h-screen min-h-0 flex-col overflow-hidden">
			<header className="bg-background flex h-14 shrink-0 items-center justify-between border-b px-4">
				<Button variant="ghost" size="sm" asChild>
					<Link href="/projects">
						<ArrowLeft className="size-4" />
						All projects
					</Link>
				</Button>
				<div className="text-center">
					<p className="text-sm font-medium">Generate timeline</p>
					<p className="text-muted-foreground text-xs">
						Build a first cut from a voiceover
					</p>
				</div>
				<div className="w-24" aria-hidden="true" />
			</header>
			<div className="mx-auto min-h-0 w-full max-w-6xl flex-1 p-4 md:p-6">
				<div className="bg-background relative h-full overflow-hidden rounded-lg border shadow-sm">
					<AiGeneratorView
						onComplete={() => router.replace(`/editor/${projectId}`)}
					/>
					{previewCandidate && (
						<div className="bg-background/90 absolute inset-0 z-20 p-4 backdrop-blur-sm md:p-8">
							<div className="size-full overflow-hidden rounded-lg border shadow-xl">
								<StockPreviewOverlay candidate={previewCandidate} />
							</div>
						</div>
					)}
				</div>
			</div>
		</main>
	);
}
