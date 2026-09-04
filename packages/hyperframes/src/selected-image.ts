export interface SelectedImageRequirement {
	id: string;
	placeholder: string;
}

export type SelectedImageValidation =
	| { valid: true }
	| { valid: false; error: string };

function readAttribute(tag: string, name: string): string | null {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = tag.match(
		new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']*)["']`, "i"),
	);
	return match?.[1] ?? null;
}

/**
 * Verifies that generated HTML applies the selected image through the exact
 * one-time placeholder and carries the marker used by preview diagnostics.
 */
export function validateSelectedImageUsage(
	html: string,
	requirement: SelectedImageRequirement,
): SelectedImageValidation {
	const placeholderCount = html.split(requirement.placeholder).length - 1;
	if (placeholderCount !== 1) {
		return {
			valid: false,
			error:
				placeholderCount === 0
					? "The generated scene did not use the selected image."
					: "The generated scene used the selected image more than once.",
		};
	}

	const matchingImage = (html.match(/<img\b[^>]*>/gi) ?? []).find(
		(tag) => readAttribute(tag, "src") === requirement.placeholder,
	);
	if (!matchingImage) {
		return {
			valid: false,
			error:
				"The selected image placeholder must be the src of an img element.",
		};
	}
	if (
		readAttribute(matchingImage, "data-opencut-selected-image") !==
		requirement.id
	) {
		return {
			valid: false,
			error: "The selected image is missing its OpenCut verification marker.",
		};
	}

	return { valid: true };
}
