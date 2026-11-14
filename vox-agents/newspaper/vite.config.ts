import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/**
 * Build the reader and export pages as static files for the loopback host.
 *
 * Relative base paths let the backend serve the same output from a subpath.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: "./",
  build: {
    outDir: "../dist-newspaper",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        reader: fileURLToPath(new URL('index.html', import.meta.url)),
        exporter: fileURLToPath(new URL('export.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5600,
    strictPort: true,
  },
});
