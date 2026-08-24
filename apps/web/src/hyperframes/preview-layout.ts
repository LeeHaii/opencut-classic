export interface HyperframesPreviewLayout {
	left: number;
	top: number;
	displayedWidth: number;
	displayedHeight: number;
	iframeScaleX: number;
	iframeScaleY: number;
}

export function getHyperframesPreviewLayout({
	elementSize,
	projectCanvasSize,
	sceneViewportSize,
	transform,
}: {
	elementSize: { width: number; height: number };
	projectCanvasSize: { width: number; height: number };
	sceneViewportSize: { width: number; height: number };
	transform: {
		position: { x: number; y: number };
		scaleX: number;
		scaleY: number;
	};
}): HyperframesPreviewLayout {
	const containScale = Math.min(
		projectCanvasSize.width / elementSize.width,
		projectCanvasSize.height / elementSize.height,
	);
	const viewportScaleX = sceneViewportSize.width / projectCanvasSize.width;
	const viewportScaleY = sceneViewportSize.height / projectCanvasSize.height;
	const displayedWidth =
		elementSize.width *
		containScale *
		Math.abs(transform.scaleX) *
		viewportScaleX;
	const displayedHeight =
		elementSize.height *
		containScale *
		Math.abs(transform.scaleY) *
		viewportScaleY;

	return {
		left: sceneViewportSize.width / 2 + transform.position.x * viewportScaleX,
		top: sceneViewportSize.height / 2 + transform.position.y * viewportScaleY,
		displayedWidth,
		displayedHeight,
		iframeScaleX: displayedWidth / elementSize.width,
		iframeScaleY: displayedHeight / elementSize.height,
	};
}
