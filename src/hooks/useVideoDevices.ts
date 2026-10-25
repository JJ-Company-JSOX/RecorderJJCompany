import { useEffect, useState } from "react";
import { enumerateMediaDevices, onMediaDevicesChanged } from "./mediaDeviceEnumeration";

export interface VideoDevice {
	deviceId: string;
	label: string;
	groupId: string;
}

export function useVideoDevices(enabled: boolean = true) {
	const [devices, setDevices] = useState<VideoDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>("default");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled) {
			setIsLoading(false);
			return;
		}

		let mounted = true;
		let activeLoadId = 0;

		const loadDevices = async () => {
			const loadId = ++activeLoadId;

			try {
				if (mounted && loadId === activeLoadId) {
					setIsLoading(true);
					setError(null);
				}

				const allDevices = await enumerateMediaDevices();
				const videoInputs = allDevices
					.filter((device) => device.kind === "videoinput")
					.map((device, index) => ({
						deviceId: device.deviceId,
						label: device.label || `Camera ${index + 1}`,
						groupId: device.groupId,
					}));

				if (mounted && loadId === activeLoadId) {
					setDevices(videoInputs);
					setSelectedDeviceId((currentDeviceId) => {
						if (currentDeviceId === "default" && videoInputs.length > 0) {
							return videoInputs[0].deviceId;
						}

						if (
							currentDeviceId !== "default" &&
							videoInputs.some((device) => device.deviceId === currentDeviceId)
						) {
							return currentDeviceId;
						}

						return videoInputs[0]?.deviceId ?? "default";
					});
				}
			} catch (error) {
				if (mounted && loadId === activeLoadId) {
					const message =
						error instanceof Error
							? error.message
							: "Failed to enumerate video devices";
					setError(message);
					console.error("Error loading video devices:", error);
				}
			} finally {
				if (mounted && loadId === activeLoadId) {
					setIsLoading(false);
				}
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
