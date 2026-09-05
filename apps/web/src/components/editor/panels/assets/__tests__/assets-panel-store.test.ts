import { beforeEach, describe, expect, it } from "bun:test";

class MemoryStorage implements Storage {
	private values = new Map<string, string>();

	get length() {
		return this.values.size;
	}

	clear() {
		this.values.clear();
	}

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	key(index: number) {
		return [...this.values.keys()][index] ?? null;
	}

	removeItem(key: string) {
		this.values.delete(key);
	}

	// eslint-disable-next-line opencut/prefer-object-params -- Web Storage API signature.
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
}

Object.defineProperty(globalThis, "window", {
	configurable: true,
	value: globalThis,
});
Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: new MemoryStorage(),
});

const { useAssetsPanelStore } = await import("../assets-panel-store");

describe("Scene Studio tab visibility", () => {
	beforeEach(() => {
		useAssetsPanelStore.setState({
			activeTab: "media",
			studioTabVisible: false,
		});
	});

	it("does not allow the hidden Studio tab to be selected", () => {
		useAssetsPanelStore.getState().setActiveTab("studio");

		expect(useAssetsPanelStore.getState().activeTab).toBe("media");
		expect(useAssetsPanelStore.getState().studioTabVisible).toBe(false);
	});

	it("reveals Studio for an edit session and keeps it available while switching tabs", () => {
		useAssetsPanelStore.getState().showStudioTab();

		expect(useAssetsPanelStore.getState().activeTab).toBe("studio");
		expect(useAssetsPanelStore.getState().studioTabVisible).toBe(true);

		useAssetsPanelStore.getState().setActiveTab("hyperframes");
		useAssetsPanelStore.getState().setActiveTab("studio");

		expect(useAssetsPanelStore.getState().activeTab).toBe("studio");
	});

	it("hides Studio and returns an active Studio panel to AI Motion", () => {
		useAssetsPanelStore.getState().showStudioTab();
		useAssetsPanelStore.getState().hideStudioTab();

		expect(useAssetsPanelStore.getState().activeTab).toBe("hyperframes");
		expect(useAssetsPanelStore.getState().studioTabVisible).toBe(false);
	});
});
