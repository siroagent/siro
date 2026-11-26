import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: {
            main: "index.html",
            ask: "ask.html",
            budget: "budget.html",
            tools: "tools.html",
            activity: "activity.html",
            docs: "docs.html",
            shipped: "shipped.html",
            privacy: "privacy.html",
            sell: "sell.html",
            notFound: "404.html",
          },
        },
      },
    },
  },
});
