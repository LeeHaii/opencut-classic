import {
	VisualNode,
	type ResolvedVisualSourceNodeState,
	type VisualNodeParams,
} from "./visual-node";

export interface VideoNodeParams extends VisualNodeParams {
	/** Display/preview URL (object URL for local files, remote URL otherwise). */
	url: string;
	/** Local bytes; absent for remote-streamed assets. */
	file?: File;
	/** Remote media URL for HTTP-range streaming when file is absent. */
	remoteUrl?: string;
	mediaId: string;
}

export class VideoNode extends VisualNode<
	VideoNodeParams,
	ResolvedVisualSourceNodeState
> {}
