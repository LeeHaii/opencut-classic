import { isRecord } from "./ai/json";
import type { RhymxApiKeys, RhymxProviderKey } from "./types";

const STORAGE_KEY = "rhymx-plugin-keys";

export function loadApiKeys(): RhymxApiKeys {
	if (typeof window === "undefined") {
		return { groq: "", pexels: "", pixabay: "" };
	}
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			return { groq: "", pexels: "", pixabay: "" };
		}
		const parsed: unknown = JSON.parse(raw);
		const read = (key: string): string => {
			const value = isRecord(parsed) ? parsed[key] : undefined;
			return typeof value === "string" ? value : "";
		};
		return {
			groq: read("groq"),
			pexels: read("pexels"),
			pixabay: read("pixabay"),
		};
	} catch {
		return { groq: "", pexels: "", pixabay: "" };
	}
}

export function saveApiKey({
	key,
	value,
}: {
	key: RhymxProviderKey;
	value: string;
}): void {
	if (typeof window === "undefined") {
		return;
	}
	const keys = loadApiKeys();
	keys[key] = value.trim();
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export async function testProviderKey({
	key,
	value,
}: {
	key: RhymxProviderKey;
	value: string;
}): Promise<boolean> {
	try {
		if (key === "groq") {
			const response = await fetch("https://api.groq.com/openai/v1/models", {
				headers: { Authorization: `Bearer ${value}` },
			});
			return response.ok;
		}
		if (key === "pexels") {
			const response = await fetch(
				"https://api.pexels.com/videos/search?query=nature&per_page=1",
				{ headers: { Authorization: value } },
			);
			return response.ok;
		}
		const response = await fetch(
			`https://pixabay.com/api/?key=${encodeURIComponent(value)}&q=nature&per_page=3`,
		);
		const data: unknown = await response.json();
		return response.ok && isRecord(data) && typeof data.total === "number";
	} catch {
		return false;
	}
}
