export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export function optionalNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function recordArray(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value)
		? value.flatMap((entry) => (isRecord(entry) ? [entry] : []))
		: [];
}
