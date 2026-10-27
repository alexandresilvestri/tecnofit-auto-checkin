import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.API_URL ?? "http://localhost:3000";
const sentry = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    sentry &&
      sentryVitePlugin({
        project: "tecnofit-auto-checkin-web",
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      }),
  ],
  build: { assetsInlineLimit: 0, sourcemap: sentry ? "hidden" : false },
  server: { proxy: { "/api": api, "/cognito": api } },
});
