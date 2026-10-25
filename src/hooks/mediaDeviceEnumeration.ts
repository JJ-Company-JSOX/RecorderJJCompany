type MediaDeviceSource = Pick<
	MediaDevices,
	"enumerateDevices" | "addEventListener" | "removeEventListener"
>;

interface EnumerationState {
	pending: Promise<MediaDeviceInfo[]> | null;
	listeners: Set<() => void>;
	onChange: () => void;
}

const states = new WeakMap<MediaDeviceSource, EnumerationState>();

function stateFor(source: MediaDeviceSource) {
	let state = states.get(source);
	if (!state) {
		const next: EnumerationState = {
			pending: null,
			listeners: new Set(),
			onChange: () => {
				// A query started before hotplug may return old devices. Invalidate it before
				// notifying consumers, then let every consumer share the same fresh query.
				next.pending = null;
				for (const listener of next.listeners) listener();
			},
		};
		states.set(source, next);
		state = next;
	}
	return state;
}

/** Share only pending work; a later request always gets a fresh hardware snapshot. */
export function enumerateMediaDevices(source: MediaDeviceSource = navigator.mediaDevices) {
	const state = stateFor(source);
	if (!state.pending) {
		const pending: Promise<MediaDeviceInfo[]> = Promise.resolve().then(() =>
			// StrictMode can retire a mount before this queued query starts. Do not
			// touch hardware for that abandoned group; current consumers have a new query.
			state.pending === pending ? source.enumerateDevices() : [],
		);
		state.pending = pending;
		// Handle both branches instead of creating an unhandled rejected finally promise.
		const release = () => {
			if (state.pending === pending) state.pending = null;
		};
		void pending.then(release, release);
	}
	return state.pending;
}

/** One browser listener gives all consumers the same hotplug generation. */
export function onMediaDevicesChanged(
	listener: () => void,
	source: MediaDeviceSource = navigator.mediaDevices,
) {
	const state = stateFor(source);
	if (!state.listeners.size) source.addEventListener("devicechange", state.onChange);
	state.listeners.add(listener);
	return () => {
		if (!state.listeners.delete(listener)) return;
		if (!state.listeners.size) {
			source.removeEventListener("devicechange", state.onChange);
			state.pending = null;
		}
	};
}
