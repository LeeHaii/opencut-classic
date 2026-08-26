import { expect, test } from "bun:test";
import type { MediaDragData } from "../drag";
import { TimelineDragSource } from "../drag-source";

test("resolves deferred media only when the drop target requests it", async () => {
	const encodedPayloads: string[] = [];
	const dataTransfer = {
		effectAllowed: "none" as DataTransfer["effectAllowed"],
		setData: (...[, value]: Parameters<DataTransfer["setData"]>) =>
			encodedPayloads.push(value),
	} satisfies Pick<DataTransfer, "effectAllowed" | "setData">;
	const provisional: MediaDragData = {
		id: "",
		type: "media",
		mediaType: "video",
		name: "Stock clip",
		duration: 14,
	};
	const resolved: MediaDragData = { ...provisional, id: "downloaded-media" };
	let resolverCalls = 0;
	const dragSource = new TimelineDragSource();

	dragSource.begin({
		dataTransfer,
		dragData: provisional,
		resolveDragData: async () => {
			resolverCalls += 1;
			return resolved;
		},
	});

	expect(resolverCalls).toBe(0);
	expect(dragSource.getActive()).toEqual(provisional);
	expect(JSON.parse(encodedPayloads[0] ?? "null")).toEqual(provisional);
	expect(await dragSource.resolveForDrop()).toEqual(resolved);
	expect(resolverCalls).toBe(1);

	dragSource.end();
	expect(dragSource.resolveForDrop()).toBeNull();
});
