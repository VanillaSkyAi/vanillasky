import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createAppIdentity, renderAppMetaTags } from "./scripts/deployment-app-identity.mjs";

export default defineConfig(({ command }) => {
  const identity = createAppIdentity(process.cwd());
  mkdirSync("functions", { recursive: true });
  writeFileSync("functions/build-identity.json", JSON.stringify(identity) + "\n");
  return {
    plugins: [react(), {
      name: "application-build",
      transformIndexHtml(html) { return html.replace("</head>", `${renderAppMetaTags(identity)}</head>`); },
      generateBundle() { this.emitFile({ type: "asset", fileName: "app-build.json", source: JSON.stringify(identity) + "\n" }); },
      configureServer(server) {
        // Development serves the real app. Server code and automated fixtures
        // are never a second application or a browser-readable setup shortcut.
        server.middlewares.use((request, response, next) => {
          let pathname: string;
          try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname).replaceAll("\\", "/"); }
          catch { response.statusCode = 400; response.end("Invalid path"); return; }
          if (/(?:^|\/)(?:functions|scripts|tests|dev|\.wrangler|\.generated|\.git|\.dev|\.env|wrangler)(?:[/.]|$)/.test(pathname)
            || /\/src\/server(?:[/.]|$)/.test(pathname)) {
            response.statusCode = 404; response.end("Not found"); return;
          }
          next();
        });
      },
    }],
    resolve: { dedupe: ["react", "react-dom"] },
    server: {
      host: "127.0.0.1", port: Number(process.env.APP_PORT ?? 4200), strictPort: true,
      fs: { deny: [".env", ".env.*", ".dev.vars", ".dev.vars.*", "**/*.pem", "**/functions/**", "**/tests/**", "**/scripts/**", "**/.wrangler/**", "**/.generated/**", "**/.git/**", "**/src/server/**", "**/src/server.ts"] },
      ...(command === "serve" ? { proxy: { "/api": { target: `http://127.0.0.1:${process.env.APP_API_PORT ?? 8788}`, changeOrigin: false } } } : {}),
    },
    build: { outDir: resolve("dist"), emptyOutDir: true },
  };
});
