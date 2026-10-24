import {
	BrowserWindow,
	dialog,
	type IpcMainInvokeEvent,
	type OpenDialogOptions,
	type OpenDialogReturnValue,
	type SaveDialogOptions,
	type SaveDialogReturnValue,
} from "electron";

function dialogParent(event: Pick<IpcMainInvokeEvent, "sender">) {
	const parent = BrowserWindow.fromWebContents(event.sender);
	return parent && !parent.isDestroyed() ? parent : null;
}

/** Native ownership keeps the modal above its always-on-top recording window.
 * Do not show/hide/focus or change HUD flags: that can break Win32 mouse forwarding.
 */
export async function showOpenDialogForSender(
	event: Pick<IpcMainInvokeEvent, "sender">,
	options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
	const parent = dialogParent(event);
	// The sender may have closed while its default folder was being resolved.
	if (!parent) return { canceled: true, filePaths: [] };
	return dialog.showOpenDialog(parent, options);
}

export async function showSaveDialogForSender(
	event: Pick<IpcMainInvokeEvent, "sender">,
	options: SaveDialogOptions,
): Promise<SaveDialogReturnValue> {
	const parent = dialogParent(event);
	if (!parent) return { canceled: true, filePath: "" };
	return dialog.showSaveDialog(parent, options);
}
