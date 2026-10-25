import { useEffect, useState } from "react";
import { enumerateMediaDevices, onMediaDevicesChanged } from "./mediaDeviceEnumeration";

export interface MicrophoneDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

let hasRequestedMicrophoneLabels = false;

export function useMicrophoneDevices(enabled: boolean = true, preferredDeviceId?: string) {
	const [devices, setDevices] = useState<MicrophoneDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Choosing another saved input only changes selection; the existing inventory suffices.
	useEffect(() => {
		if (!enabled) return;
		setSelectedDeviceId((currentDeviceId) => {
			const preferred = preferredDeviceId ?? "default";
			if (devices.some((device) => device.deviceId === preferred)) return preferred;
			if (
				currentDeviceId !== "default" &&
				devices.some((device) => device.deviceId === currentDeviceId)
			)
				return currentDeviceId;
			return (
				devices.find((device) => device.deviceId !== "default")?.deviceId ??
				devices[0]?.deviceId ??
				"default"
			);
		});
	}, [devices, enabled, preferredDeviceId]);

	useEffect(() => {
		if (!enabled) {
			setIsLoading(false);
			return;
		}

		let mounted = true;
		let activeLoadId = 0;

		const loadDevices = async () => {
			const loadId = ++activeLoadId;
			let permissionStream: MediaStream | null = null;

			try {
				setIsLoading(true);
				setError(null);

				let allDevices = await enumerateMediaDevices();
				let audioInputs = allDevices
					.filter((device) => device.kind === "audioinput")
					.map((device) => ({
						deviceId: device.deviceId,
						label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
						groupId: device.groupId,
					}));

				const needsLabelPermission =
					audioInputs.length > 0 && audioInputs.every((device) => !device.label.trim());

				if (needsLabelPermission && !hasRequestedMicrophoneLabels) {
					hasRequestedMicrophoneLabels = true;
					permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
					allDevices = await enumerateMediaDevices();
					audioInputs = allDevices
						.filter((device) => device.kind === "audioinput")
						.map((device) => ({
							deviceId: device.deviceId,
							label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
							groupId: device.groupId,
						}));
				}

				if (mounted && loadId === activeLoadId) {
					setDevices(audioInputs);
					setIsLoading(false);
				}
			} catch (error) {
				if (mounted && loadId === activeLoadId) {
					const message =
						error instanceof Error
							? error.message
							: "Failed to enumerate audio devices";
					setError(message);
					setIsLoading(false);
					console.error("Error loading microphone devices:", error);
				}
			} finally {
				permissionStream?.getTracks().forEach((track) => track.stop());
			}
		};

		const handleDeviceChange = () => {
			void loadDevices();
		};
		const unsubscribe = onMediaDevicesChanged(handleDeviceChange);
		void loadDevices();

		return () => {
			mounted = false;
			unsubscribe();
		};
	}, [enabled]);

	return {
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		isLoading,
		error,
	};
}
