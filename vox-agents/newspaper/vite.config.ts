import { realpathSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vite";

// Match the paths Vite resolves for inline CSS, even when the Windows drive letter is lowercase.
const root = realpathSync.native(new URL('.', import.meta.url));

/**
 * Build the reader and export pages as static files for the loopback host.
 *
 * Relative base paths let the backend serve the same output from a subpath.
 */
export default defineConfig({
  root,
  base: "./",
  resolve: {
    alias: [
      // Swap the Node design reader for the bundled JSON reader at the only specifier that imports it.
      {
        find: "../design-assets-source.js",
        replacement: join(root, "src/design-assets-source.ts"),
      },
    ],
  },
  build: {
    outDir: "../dist-newspaper",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        reader: join(root, 'index.html'),
        exporter: join(root, 'export.html'),
      },
    },
  },
  server: {
    port: 5600,
    strictPort: true,
  },
});
