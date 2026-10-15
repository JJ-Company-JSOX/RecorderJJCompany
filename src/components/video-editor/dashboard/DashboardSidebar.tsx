import { ACCOUNTS_ENABLED } from "@/lib/productFeatures";
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { RecordNewButton } from "./RecordNewButton";
import { SidebarCards } from "./SidebarCards";
import { FolderRow } from "./FolderRow";
import { Cloud, File, GearSix, House, Plus, UploadSimple, UserCircle } from "@/components/ui/icons";

import { Button } from "@/components/ui/button";

import type { DashboardProps } from "./types";

import type { DashboardModel } from "./useDashboardModel";
import { FOLDER_COLORS } from "./useProjectFolders";

export function DashboardSidebar({
	busy,
	run,
	folders,
	save,
	section,
	setSection,
	metadata,
	update,
	navClass,
	onSignIn,
	accountLabel,
	onImportFile,
}: Pick<
	DashboardProps & DashboardModel,
	| "busy"
	| "run"
	| "folders"
	| "save"
	| "section"
	| "setSection"
	| "metadata"
	| "update"
	| "navClass"
	| "onSignIn"
	| "accountLabel"
	| "onImportFile"
>) {
	return (
		<>
			<aside
				aria-label="Library navigation"
				className="flex w-48 shrink-0 flex-col bg-transparent px-4 pb-5 pt-12 lg:w-56"
			>
				<div className="mb-4 flex h-10 items-center gap-2.5 px-3">
					<img
						src={`${import.meta.env.BASE_URL}app-icons/jsox-mark.svg`}
						alt=""
						className="size-7 rounded-lg"
					/>
					<span className="text-[13px] font-semibold tracking-tight">Jsox Recorder</span>
				</div>
				<p className="mb-4 px-3 text-[10px] text-muted-foreground">Based on Recordly / OpenScreen</p>
				<RecordNewButton busy={busy} run={run} className="mb-2 w-full" />
				<Button variant="secondary" disabled={busy} onClick={() => void run(onImportFile)}
					className="mb-1 h-10 w-full gap-2 text-[13px]" aria-label="Import video" title="Choose a local video or project. No cloud upload.">
					<UploadSimple className="size-4" />Import video
				</Button>
				<p className="mb-5 px-2 text-[10px] text-muted-foreground">From your computer · no upload</p>
				<nav className="space-y-1">
					<Button variant="ghost" className={navClass(section === "ai-studio")}
						aria-current={section === "ai-studio" ? "page" : undefined}
						onClick={() => setSection("ai-studio")}>
						<Cloud className="size-[18px]" />AI Studio
					</Button>
					<Button
						variant="ghost"
						className={navClass(section === "projects")}
						aria-current={section === "projects" ? "page" : undefined}
						onClick={() => setSection("projects")}
					>
						<House weight="fill" className="size-[18px]" />
						Home
					</Button>
{ACCOUNTS_ENABLED && 					<Button
						variant="ghost"
						className={navClass(section === "shared")}
						aria-current={section === "shared" ? "page" : undefined}
						onClick={() => setSection("shared")}
					>
						<Cloud
							weight={section === "shared" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						Shared
					</Button>}
					<Button
						variant="ghost"
						className={navClass(section === "raw")}
						aria-current={section === "raw" ? "page" : undefined}
						onClick={() => setSection("raw")}
					>
						<File
							weight={section === "raw" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						Raw
					</Button>
				</nav>
				<div className="mb-2 mt-9 flex items-center justify-between pl-3">
					<h2 className="text-[13px] font-semibold tracking-tight text-foreground/80">
						Folders
					</h2>
					<Button
						variant="ghost"
						size="icon"
						className="size-7 min-w-7"
						aria-label="New folder"
						onClick={() => {
							let name = "Untitled folder",
								index = 1;
							while (folders.some((folder) => folder.name === name))
								name = `Untitled folder ${index++}`;
							save([
								...folders,
								{
									id: crypto.randomUUID(),
									name,
									color: FOLDER_COLORS[0],
									paths: [],
								},
							]);
						}}
					>
						<Plus className="size-3.5" />
					</Button>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto space-y-1">
					{folders.map((folder) => (
						<FolderRow
							key={folder.id}
							folder={folder}
							active={section === folder.id}
							onSelect={() => setSection(folder.id)}
							onChange={(next) =>
								save(folders.map((item) => (item.id === next.id ? next : item)))
							}
							onRemove={() => {
								save(folders.filter((item) => item.id !== folder.id));
								if (section === folder.id) setSection("projects");
							}}
							colors={metadata.colors}
							onColors={(colors) => update({ ...metadata, colors })}
						/>
					))}
				</div>
				<div className="space-y-1 pt-6">
					<SidebarCards />
					<FeedbackDialog showLabel className={navClass(false)} onSignIn={onSignIn} />
					<Button
						variant="ghost"
						className={navClass(section === "settings")}
						aria-current={section === "settings" ? "page" : undefined}
						onClick={() => setSection("settings")}
					>
						<GearSix
							weight={section === "settings" ? "fill" : "regular"}
							className="size-[18px]"
						/>
						Settings
					</Button>
					{ACCOUNTS_ENABLED && <Button variant="ghost" className={navClass(false)} onClick={onSignIn}>
						<UserCircle weight="fill" className="size-[18px] shrink-0" />
						<span className="truncate">{accountLabel || "Sign in"}</span>
					</Button>}
				</div>
			</aside>
		</>
	);
}
