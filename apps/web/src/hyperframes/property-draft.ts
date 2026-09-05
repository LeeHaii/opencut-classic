export interface StudioPropertyDraft {
	sourceValue: string;
	draft: string;
}

export function updateStudioPropertyDraft({
	current,
	sourceValue,
	nextValue,
}: {
	current: StudioPropertyDraft | null;
	sourceValue: string;
	nextValue: string;
}): StudioPropertyDraft {
	return {
		sourceValue: current?.sourceValue ?? sourceValue,
		draft: nextValue,
	};
}

export function studioPropertyDraftCommitValue({
	draft,
}: {
	draft: StudioPropertyDraft | null;
}): string | null {
	if (!draft || draft.draft === draft.sourceValue) return null;
	return draft.draft;
}
