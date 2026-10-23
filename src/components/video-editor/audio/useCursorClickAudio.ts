import { useEffect, useRef } from "react";
import type { AudioRegion } from "../types";
import { CURSOR_CLICK_SAMPLE_RATE, createCursorClickSamples } from "./cursorClickSound";

/** One context and one short buffer, rather than an HTMLAudioElement for every click. */
export function useCursorClickAudio(
	regions: AudioRegion[],
	timeSeconds: number,
	playing: boolean,
	masterVolume: number,
) {
	const context = useRef<AudioContext | null>(null);
	const buffer = useRef<AudioBuffer | null>(null);
	const previousMs = useRef<number | null>(null);
	const nodes = useRef(new Set<AudioBufferSourceNode>());
	const run = useRef(0);
	useEffect(
		() => () => {
			run.current++;
			for (const node of nodes.current) node.stop();
			nodes.current.clear();
			void context.current?.close().catch(() => undefined);
			context.current = null;
			buffer.current = null;
		},
		[],
	);
	useEffect(() => {
		const currentMs = timeSeconds * 1000;
		const previous = previousMs.current;
		previousMs.current = playing ? currentMs : null;
		const generation = ++run.current;
		if (!playing || !regions.length || masterVolume <= 0) {
			for (const node of nodes.current) node.stop();
			nodes.current.clear();
			return;
		}
		// Scrubbing must not play every click between the old and new playheads.
		if (previous !== null && (currentMs < previous || currentMs - previous > 250)) return;
		const lowerMs = previous ?? currentMs - 1;
		let left = 0,
			right = regions.length;
		while (left < right) {
			const mid = (left + right) >>> 1;
			if (regions[mid].startMs <= lowerMs) left = mid + 1;
			else right = mid;
		}
		const due: AudioRegion[] = [];
		for (let i = left; i < regions.length && regions[i].startMs <= currentMs; i++)
			due.push(regions[i]);
		if (!due.length) return;
		try {
			const audio = context.current ?? new AudioContext({ latencyHint: "interactive" });
			context.current = audio;
			if (!buffer.current) {
				const samples = createCursorClickSamples();
				buffer.current = audio.createBuffer(1, samples.length, CURSOR_CLICK_SAMPLE_RATE);
				buffer.current.copyToChannel(samples, 0);
			}
			void audio
				.resume()
				.then(() => {
					if (run.current !== generation || !buffer.current) return;
					for (const region of due) {
						const source = audio.createBufferSource();
						const gain = audio.createGain();
						source.buffer = buffer.current;
						gain.gain.value = Math.min(1, region.volume * masterVolume);
						source.connect(gain);
						gain.connect(audio.destination);
						nodes.current.add(source);
						source.onended = () => {
							nodes.current.delete(source);
							source.disconnect();
							gain.disconnect();
						};
						source.start(
							0,
							0,
							Math.min(
								buffer.current.duration,
								(region.endMs - region.startMs) / 1000,
							),
						);
					}
				})
				.catch(() => undefined);
		} catch {
			/* A disabled audio output must not stop video playback. */
		}
	}, [regions, timeSeconds, playing, masterVolume]);
}
