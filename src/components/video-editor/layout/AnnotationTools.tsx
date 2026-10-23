import { Button } from "@/components/ui/button";
import { ArrowRight, BoundingBox, TextT } from "@/components/ui/icons";
import { useScopedT } from "@/contexts/I18nContext";

export type QuickAnnotationType = "text" | "figure" | "blur";
export function AnnotationTools({
	disabled,
	onAdd,
}: {
	disabled: boolean;
	onAdd: (type: QuickAnnotationType) => void;
}) {
	const t = useScopedT("settings");
	const tools = [
		{ type: "text" as const, label: t("annotationTools.text", "Text"), icon: TextT },
		{ type: "figure" as const, label: t("annotationTools.arrow", "Arrow"), icon: ArrowRight },
		{ type: "blur" as const, label: t("annotationTools.blur", "Blur mask"), icon: BoundingBox },
	];
	return (
		<section
			className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pb-5"
			aria-label={t("annotationTools.title", "Annotation tools")}
		>
			<p className="text-xs text-muted-foreground">
				{t(
					"annotationTools.help",
					"Add a layer at the playhead, then edit its appearance and duration. Changes are saved in the project and included in exports.",
				)}
			</p>
			<div className="grid grid-cols-2 gap-2">
				{tools.map((tool) => (
					<Button
						key={tool.type}
						type="button"
						variant="outline"
						disabled={disabled}
						className="flex h-24 min-w-0 flex-col gap-2"
						onClick={() => onAdd(tool.type)}
					>
						<tool.icon className="size-6" />
						<span>{tool.label}</span>
					</Button>
				))}
			</div>
		</section>
	);
}
