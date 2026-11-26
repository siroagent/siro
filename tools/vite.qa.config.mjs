// Client-only build for local review: the same pages as vite.config.ts without the Cloudflare plugin,
// so a reviewer can build into its own folder (npx vite build --config tools/vite.qa.config.mjs --outDir <dir>)
// and serve it with PREVIEW_ROOT=<dir> node tools/preview.mjs <port>, without touching dist/.
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "index.html",
        ask: "ask.html",
        budget: "budget.html",
        tools: "tools.html",
        activity: "activity.html",
        docs: "docs.html",
        shipped: "shipped.html",
        notFound: "404.html",
      },
    },
  },
});
