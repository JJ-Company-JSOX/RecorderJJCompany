import { describe, expect, it, vi } from "vitest";
import { enumerateMediaDevices, onMediaDevicesChanged } from "./mediaDeviceEnumeration";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function mediaDevices() {
	const target = new EventTarget();
	return {
		enumerateDevices: vi.fn<() => Promise<MediaDeviceInfo[]>>(),
		addEventListener: vi.fn(target.addEventListener.bind(target)),
		removeEventListener: vi.fn(target.removeEventListener.bind(target)),
		change: () => target.dispatchEvent(new Event("devicechange")),
	};
}

const device = (deviceId: string) =>
	({
		deviceId,
		kind: "audioinput",
		label: deviceId,
		groupId: "usb",
		toJSON: () => ({}),
	}) as MediaDeviceInfo;

describe("shared media device enumeration", () => {
	it("skips an abandoned queued request when a new mount group already replaced it", async () => {
		const source = mediaDevices();
		source.enumerateDevices.mockResolvedValue([device("fresh")]);
		const stop = onMediaDevicesChanged(() => undefined, source);
		const abandoned = enumerateMediaDevices(source);
		stop();
		const stopNew = onMediaDevicesChanged(() => undefined, source);
		const current = enumerateMediaDevices(source);
		await expect(abandoned).resolves.toEqual([]);
		expect((await current)[0].deviceId).toBe("fresh");
		expect(source.enumerateDevices).toHaveBeenCalledOnce();
		stopNew();
	});
	it("shares one pending hardware query between microphone and camera consumers", async () => {
		const source = mediaDevices();
		const result = deferred<MediaDeviceInfo[]>();
		source.enumerateDevices.mockReturnValue(result.promise);
		const microphone = enumerateMediaDevices(source);
		const camera = enumerateMediaDevices(source);
		expect(microphone).toBe(camera);
		await Promise.resolve();
		expect(source.enumerateDevices).toHaveBeenCalledOnce();
		const inventory = [device("mic-1")];
		result.resolve(inventory);
		await expect(microphone).resolves.toBe(inventory);
		await expect(camera).resolves.toBe(inventory);
	});

	it("does not cache completed inventories or mix different browser device sources", async () => {
		const first = mediaDevices();
		const second = mediaDevices();
		first.enumerateDevices
			.mockResolvedValueOnce([device("old")])
			.mockResolvedValueOnce([device("new")]);
		second.enumerateDevices.mockResolvedValue([device("other")]);
		expect((await enumerateMediaDevices(first))[0].deviceId).toBe("old");
		expect((await enumerateMediaDevices(first))[0].deviceId).toBe("new");
		expect((await enumerateMediaDevices(second))[0].deviceId).toBe("other");
		expect(first.enumerateDevices).toHaveBeenCalledTimes(2);
		expect(second.enumerateDevices).toHaveBeenCalledOnce();
	});

	it("releases a failed or synchronously throwing query so a subsequent refresh can retry", async () => {
		const source = mediaDevices();
		source.enumerateDevices
			.mockRejectedValueOnce(new Error("Blocked"))
			.mockImplementationOnce(() => {
				throw new Error("Unavailable");
			})
			.mockResolvedValueOnce([device("recovered")]);
		await expect(enumerateMediaDevices(source)).rejects.toThrow("Blocked");
		await expect(enumerateMediaDevices(source)).rejects.toThrow("Unavailable");
		expect((await enumerateMediaDevices(source))[0].deviceId).toBe("recovered");
	});

	it("invalidates older pending work once on hotplug before notifying both consumers", async () => {
		const source = mediaDevices();
		const old = deferred<MediaDeviceInfo[]>();
		const fresh = deferred<MediaDeviceInfo[]>();
		source.enumerateDevices.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
		const notifications: Promise<MediaDeviceInfo[]>[] = [];
		const stopMic = onMediaDevicesChanged(() => {
			notifications.push(enumerateMediaDevices(source));
		}, source);
		const stopCamera = onMediaDevicesChanged(() => {
			notifications.push(enumerateMediaDevices(source));
		}, source);
		expect(source.addEventListener).toHaveBeenCalledOnce();
		const previous = enumerateMediaDevices(source);
		await Promise.resolve();
		source.change();
		await Promise.resolve();
		expect(notifications).toHaveLength(2);
		expect(notifications[0]).toBe(notifications[1]);
		expect(notifications[0]).not.toBe(previous);
		expect(source.enumerateDevices).toHaveBeenCalledTimes(2);
		// Finishing the old query must not clear the replacement query.
		old.resolve([device("removed")]);
		await previous;
		expect(enumerateMediaDevices(source)).toBe(notifications[0]);
		fresh.resolve([device("plugged-in")]);
		for (const notification of notifications)
			expect((await notification)[0].deviceId).toBe("plugged-in");
		stopMic();
		expect(source.removeEventListener).not.toHaveBeenCalled();
		stopCamera();
		expect(source.removeEventListener).toHaveBeenCalledOnce();
	});

	it("removes the browser listener after the last consumer and ignores repeated cleanup", () => {
		const source = mediaDevices();
		const consumer = vi.fn();
		const stop = onMediaDevicesChanged(consumer, source);
		stop();
		stop();
		source.change();
		expect(consumer).not.toHaveBeenCalled();
		expect(source.removeEventListener).toHaveBeenCalledOnce();
	});

	it("does not reuse a query from a previously unmounted group of consumers", async () => {
		const source = mediaDevices();
		const abandoned = deferred<MediaDeviceInfo[]>();
		source.enumerateDevices
			.mockReturnValueOnce(abandoned.promise)
			.mockResolvedValueOnce([device("fresh")]);
		const stop = onMediaDevicesChanged(() => undefined, source);
		const previous = enumerateMediaDevices(source);
		await Promise.resolve();
		stop();
		const stopNew = onMediaDevicesChanged(() => undefined, source);
		const next = enumerateMediaDevices(source);
		expect(next).not.toBe(previous);
		expect((await next)[0].deviceId).toBe("fresh");
		abandoned.resolve([device("stale")]);
		await previous;
		stopNew();
	});
});
