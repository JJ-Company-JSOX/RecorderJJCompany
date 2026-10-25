import { Toaster } from "../ui/toast";
import { LaunchWindow } from "./LaunchWindow";

export default function HudWindow() {
	return (
		<>
			<LaunchWindow />
			<Toaster
				placement="top"
				className="pointer-events-auto min-w-0 max-w-[calc(100vw_-_300px)]"
			/>
		</>
	);
}
