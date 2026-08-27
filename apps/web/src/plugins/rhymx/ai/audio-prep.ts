import { extractErrorMessage } from "./groq-client";

/**
 * Container formats Whisper accepts on Groq. Anything else (mkv, mov, aac,
 * extension-less blobs, ...) must be transcoded before upload.
 */
const SUPPORTED_EXTENSIONS = new Set([
	"flac",
	"mp3",
	"mp4",
	"mpeg",
	"mpga",
	"m4a",
	"ogg",
	"opus",
	"wav",
	"webm",
]);

const TARGET_SAMPLE_RATE = 16_000;
const SUPPORTED_LABEL = "flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm";

/**
 * Returns the file unchanged when Groq can ingest it directly; otherwise
 * decodes it with WebAudio and re-encodes it as a 16 kHz mono WAV so
 * transcription never fails on the container format.
 */
export async function prepareTranscriptionFile({
	file,
}: {
	file: File;
}): Promise<File> {
	if (isSupportedContainer(file.name)) {
		return file;
	}
	try {
		return await transcodeToWav({ file });
	} catch (error) {
		const detail = extractErrorMessage(error);
		throw new Error(
			`Could not read "${file.name}" for transcription (${detail ?? "unsupported format"}). Supported formats: ${SUPPORTED_LABEL}.`,
		);
	}
}

function isSupportedContainer(name: string): boolean {
	const match = /\.([a-z0-9]+)$/i.exec(name.trim());
	return match !== null && SUPPORTED_EXTENSIONS.has(match[1].toLowerCase());
}

async function transcodeToWav({ file }: { file: File }): Promise<File> {
	const arrayBuffer = await file.arrayBuffer();
	const audioContext = new AudioContext();
	let decoded: AudioBuffer;
	try {
		decoded = await audioContext.decodeAudioData(arrayBuffer);
	} finally {
		void audioContext.close();
	}

	const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
	const offline = new OfflineAudioContext({
		numberOfChannels: 1,
		length,
		sampleRate: TARGET_SAMPLE_RATE,
	});
	const source = offline.createBufferSource();
	source.buffer = decoded;
	source.connect(offline.destination);
	source.start();
	const rendered = await offline.startRendering();

	const blob = encodeWav({
		samples: rendered.getChannelData(0),
		sampleRate: TARGET_SAMPLE_RATE,
	});
	return new File([blob], `${stripExtension(file.name) || "voiceover"}.wav`, {
		type: "audio/wav",
	});
}

function stripExtension(name: string): string {
	return name.replace(/\.[^.]+$/, "");
}

/** Minimal 16-bit PCM RIFF/WAVE encoder (mono). */
function encodeWav({
	samples,
	sampleRate,
}: {
	samples: Float32Array;
	sampleRate: number;
}): Blob {
	const bytesPerSample = 2;
	const dataSize = samples.length * bytesPerSample;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	const writeString = ({ offset, str }: { offset: number; str: string }) => {
		for (let index = 0; index < str.length; index++) {
			view.setUint8(offset + index, str.charCodeAt(index));
		}
	};

	writeString({ offset: 0, str: "RIFF" });
	view.setUint32(4, 36 + dataSize, true);
	writeString({ offset: 8, str: "WAVE" });
	writeString({ offset: 12, str: "fmt " });
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * bytesPerSample, true);
	view.setUint16(32, bytesPerSample, true);
	view.setUint16(34, 16, true);
	writeString({ offset: 36, str: "data" });
	view.setUint32(40, dataSize, true);

	let offset = 44;
	for (let index = 0; index < samples.length; index++) {
		const sample = Math.max(-1, Math.min(1, samples[index]));
		view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}
