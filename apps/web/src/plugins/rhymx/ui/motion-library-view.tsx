"use client";

import { useEffect, useRef } from "react";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import { Badge } from "@/components/ui/badge";
import { useEditor } from "@/editor/use-editor";
import { buildGraphicElement } from "@/timeline/element-utils";
import { buildDefaultParamValues } from "@/params/registry";
import { mediaTimeFromSeconds } from "@/wasm";
import { toast } from "sonner";
import type { GraphicDefinition } from "@/graphics";
import type { MotionTemplateMeta } from "../motion/library-types";
import {
	getRhymxTemplate,
	listRhymxTemplates,
} from "../motion/library";

export function MotionLibraryView() {
	const templates = listRhymxTemplates();

	return (
		<PanelView title="Motion Templates">
			<div className="flex flex-col gap-3 pb-4">
				<p className="text-muted-foreground px-1 text-xs">
					Animated graphics rendered natively by the editor. Click to add at
					the playhead, then edit contents in Properties.
				</p>
				<div
					className="grid gap-2"
					style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
				>
					{templates.map((meta) => (
						<TemplateCard key={meta.id} meta={meta} />
					))}
				</div>
			</div>
		</PanelView>
	);
}

function TemplateCard({ meta }: { meta: MotionTemplateMeta }) {
	const editor = useEditor();

	const handleAdd = () => {
		const template = getRhymxTemplate({ templateId: meta.id });
		if (!template) {
			return;
		}
		const currentTime = editor.playback.getCurrentTime();
		const element = buildGraphicElement({
			definitionId: template.definition.id,
			name: template.meta.name,
			startTime: currentTime,
		});
		element.duration = mediaTimeFromSeconds({
			seconds: template.meta.defaultDurationSec,
		});
		editor.timeline.insertElement({
			element,
			placement: { mode: "auto" },
		});
		toast.success(`Added ${template.meta.name} to timeline`);
	};

	return (
		<button
			type="button"
			onClick={handleAdd}
			className="group bg-background hover:border-primary flex w-full flex-col gap-2 overflow-hidden rounded-md border p-0 text-left transition-colors"
		>
			<MotionPreview
				definition={templateDefinition(meta.id)}
				durationSec={meta.defaultDurationSec}
			/>
			<div className="flex flex-col gap-1 px-2 pb-2">
				<span className="text-foreground text-xs font-medium">{meta.name}</span>
				<Badge variant="secondary" className="w-fit text-[10px]">
					{meta.category}
				</Badge>
			</div>
		</button>
	);
}

function templateDefinition(templateId: string): GraphicDefinition | null {
	return getRhymxTemplate({ templateId })?.definition ?? null;
}

function MotionPreview({
	definition,
	durationSec,
}: {
	definition: GraphicDefinition | null;
	durationSec: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !definition) {
			return;
		}
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		const width = 240;
		const height = 135;
		canvas.width = width;
		canvas.height = height;
		const params = buildDefaultParamValues(definition.params);
		let raf = 0;
		const start = performance.now();
		let cancelled = false;

		const frame = (now: number) => {
			if (cancelled) {
				return;
			}
			const localTime = ((now - start) / 1000) % durationSec;
			ctx.clearRect(0, 0, width, height);
			definition.render({
				ctx,
				params,
				width,
				height,
				localTime,
				durationSec,
			});
			raf = requestAnimationFrame(frame);
		};
		raf = requestAnimationFrame(frame);

		return () => {
			cancelled = true;
			cancelAnimationFrame(raf);
		};
	}, [definition, durationSec]);

	if (!definition) {
		return null;
	}
	return (
		<canvas
			ref={canvasRef}
			className="bg-muted aspect-video w-full rounded-t-md object-cover"
		/>
	);
}
