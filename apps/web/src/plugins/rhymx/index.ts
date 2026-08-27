import { ensureRhymxMotionTemplates } from "./motion/library";

/**
 * Rhymx plugin entry point. Registers the motion template library into the
 * editor's graphics registry and prepares the AI wizard.
 *
 * Called once during EditorCore construction (mirrors registerDefaultEffects).
 */
export function registerRhymxPlugin(): void {
	ensureRhymxMotionTemplates();
}
