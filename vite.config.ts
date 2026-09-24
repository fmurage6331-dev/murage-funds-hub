// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    plugins: [
      {
        name: "filter-dependency-client-directives",
        configEnvironment(name, config) {
          if (name !== "nitro") return;
          // Nitro sets inlineDynamicImports=false alongside explicit code splitting.
          // Rolldown warns about the redundant option even though it is false;
          // removing it leaves Nitro's chunking configuration unchanged.
          for (const bundler of [config.build?.rolldownOptions, config.build?.rollupOptions]) {
            const output = bundler?.output;
            if (
              output &&
              !Array.isArray(output) &&
              output.inlineDynamicImports === false &&
              output.codeSplitting
            ) {
              delete output.inlineDynamicImports;
            }
          }
        },
        onLog(level, log) {
          // The third-party React "use client" annotations are inert here.
          // Keep all other build diagnostics visible.
          if (
            level === "warn" &&
            log.code === "MODULE_LEVEL_DIRECTIVE" &&
            log.id?.includes("node_modules/") &&
            log.message?.includes('"use client"')
          )
            return false;
        },
      },
    ],
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
