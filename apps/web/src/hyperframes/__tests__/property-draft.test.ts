import { describe, expect, test } from "bun:test";
import {
	studioPropertyDraftCommitValue,
	updateStudioPropertyDraft,
} from "../property-draft";

describe("Scene Studio property drafts", () => {
	test("keeps the original source while live preview echoes the draft", () => {
		const initial = updateStudioPropertyDraft({
			current: null,
			sourceValue: "Elon Musk",
			nextValue: "Elon R. Musk",
		});
		const afterPreviewEcho = updateStudioPropertyDraft({
			current: initial,
			sourceValue: "Elon R. Musk",
			nextValue: "Elon Reeve Musk",
		});

		expect(afterPreviewEcho.sourceValue).toBe("Elon Musk");
		expect(studioPropertyDraftCommitValue({ draft: afterPreviewEcho })).toBe(
			"Elon Reeve Musk",
		);
	});

	test("does not commit an unchanged draft", () => {
		const draft = updateStudioPropertyDraft({
			current: null,
			sourceValue: "Founder",
			nextValue: "Founder",
		});

		expect(studioPropertyDraftCommitValue({ draft })).toBeNull();
	});
});
