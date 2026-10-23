import { spawnSync } from "node:child_process";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { build as buildElectronEntry } from "vite-plugin-electron";
import electron from "vite-plugin-electron/simple";

function electronMainCjsOutputPlugin(): Plugin {
	return {
		name: "recordly-electron-main-cjs-output",
		enforce: "post",
		config(config) {
			// Vite mergeConfig concatenates lib.formats with the plugin's ESM default.
			config.build ??= {};
			const build = config.build;
			const lib = build.lib;
			if (lib && typeof lib === "object") {
				lib.formats = ["cjs"];
				lib.fileName = (_format, entryName) => `${entryName}.cjs`;
			}

			build.rollupOptions ??= {};
			const rollupOptions = build.rollupOptions;
			const cjsOutput = {
				format: "cjs" as const,
				inlineDynamicImports: true,
				entryFileNames: "[name].cjs",
				chunkFileNames: "[name]-[hash].cjs",
			};

			rollupOptions.output = Array.isArray(rollupOptions.output)
				? rollupOptions.output.map((output) => ({ ...output, ...cjsOutput }))
				: { ...(rollupOptions.output ?? {}), ...cjsOutput };
		},
	};
}

function electronMainCjsGuardPlugin(): Plugin {
	return {
		name: "recordly-electron-main-cjs-guard",
		closeBundle() {
			const scriptPath = path.resolve(__dirname, "scripts/smoke-electron-main-cjs.mjs");
			const result = spawnSync(process.execPath, [scriptPath], {
				cwd: __dirname,
				encoding: "utf8",
			});

			if (result.status !== 0) {
				const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
				throw new Error(
					`Electron main CJS smoke failed after Vite build.${details ? `\n${details}` : ""}`,
				);
			}
		},
	};
}

// The bundled OCR engine runs onnxruntime-web in a worker thread, which needs its own entry
// file next to main.cjs (dist-electron/ocr-worker.cjs). The main bundle inlines every dynamic
// import into one file, so the worker is built separately, with the same Node/CJS settings.
function ocrWorkerBuildPlugin(): Plugin {
	return {
		name: "recordly-ocr-worker",
		async closeBundle() {
			await buildElectronEntry({
				entry: {
					"ocr-worker": path.join(__dirname, "electron/ipc/autoEdit/ocr/worker.ts"),
				},
				vite: {
					root: __dirname,
					logLevel: "warn",
					build: { watch: null },
					plugins: [electronMainCjsOutputPlugin()],
				},
			});
		},
	};
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
	plugins: [
		react(),
		...(mode === "ui" || process.env.RECORDLY_RENDERER_ONLY === "1"
			? []
			: [
					electron({
						main: {
							// Shortcut of `build.lib.entry`.
							entry: "electron/main.ts",
							vite: {
								build: {
									lib: {
										entry: "electron/main.ts",
										formats: ["cjs"],
										fileName: (_format, entryName) => `${entryName}.cjs`,
									},
									rollupOptions: {
										external: [
											"ffmpeg-static",
											"uiohook-napi",
											"sherpa-onnx-node",
										],
										output: {
											format: "cjs",
											inlineDynamicImports: true,
											entryFileNames: "[name].cjs",
											chunkFileNames: "[name]-[hash].cjs",
										},
									},
								},
								plugins: [
									electronMainCjsOutputPlugin(),
									electronMainCjsGuardPlugin(),
									ocrWorkerBuildPlugin(),
								],
							},
						},
						preload: {
							// Shortcut of `build.rollupOptions.input`.
							// Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
							input: path.join(__dirname, "electron/preload.ts"),
						},
						// Polyfill the Electron and Node.js API for the renderer process.
						// If you want to use Node.js in the renderer process, enable `nodeIntegration` in the main process.
						// See https://github.com/electron-vite/vite-plugin-electron-renderer
						renderer:
							process.env.NODE_ENV === "test"
								? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
									undefined
								: {},
					}),
				]),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
	server: {
		watch: {
			// Diagnostic Electron profiles contain locked databases; neither these
			// files nor generated test packages should trigger source reloads.
			ignored: [
				"**/.tmp/**",
				"**/release/**",
				"**/vendor/offline-ai/**",
				"**/vendor/offline-tools/**",
				"**/electron/native/**/build/**",
			],
		},
	},
	optimizeDeps: {
		entries: ["index.html"],
		// React Aria imports this CommonJS shim through its ESM collection modules.
		include: ["use-sync-external-store/shim"],
		exclude: [
			"react-icons/bs",
			"react-icons/fa",
			"react-icons/fa6",
			"react-icons/fi",
			"react-icons/md",
			"react-icons/rx",
		],
	},
	build: {
		target: "esnext",
		minify: "terser",
		terserOptions: {
			compress: {
				drop_console: true,
				drop_debugger: true,
				pure_funcs: ["console.log", "console.debug"],
			},
		},
		rollupOptions: {
			output: {
				manualChunks: {
					"react-vendor": ["react", "react-dom"],
					"video-processing": ["mediabunny", "mp4box", "@fix-webm-duration/fix"],
				},
			},
		},
		chunkSizeWarningLimit: 1000,
	},
}));
