import { defineConfig } from "vite";

// One self-contained ES module, served by the integration from
// custom_components/homeslice/frontend/.
export default defineConfig({
  build: {
    minify: true,
    outDir: "custom_components/homeslice/frontend",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    lib: {
      entry: "frontend/main.ts",
      formats: ["es"],
      fileName: () => "homeslice.js",
    },
  },
  test: {
    include: ["frontend/**/*.test.ts"],
  },
});
