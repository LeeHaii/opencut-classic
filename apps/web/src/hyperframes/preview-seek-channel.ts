/** UI transport backpressure, not a second playback clock. */
export class PreviewSeekChannel {
	private sequence = 0;
	private generation = 0;
	private pending: { time: number; generation: number } | null = null;
	private inFlight: {
		time: number;
		generation: number;
		requestId: string;
	} | null = null;

	constructor(private readonly token: string) {}

	request({
		time,
		discontinuity = false,
	}: {
		time: number;
		discontinuity?: boolean;
	}) {
		if (discontinuity) this.generation += 1;
		this.pending = { time, generation: this.generation };
		return this.takeNext();
	}

	acknowledge(requestId: string | undefined) {
		if (!this.inFlight || requestId !== this.inFlight.requestId) {
			return { accepted: false, next: null };
		}
		const accepted = this.inFlight.generation === this.generation;
		this.inFlight = null;
		return { accepted, next: this.takeNext() };
	}

	retry() {
		return this.inFlight;
	}

	private takeNext() {
		if (this.inFlight || !this.pending) return null;
		this.inFlight = {
			...this.pending,
			requestId: `${this.token}:seek-${++this.sequence}`,
		};
		this.pending = null;
		return this.inFlight;
	}
}
