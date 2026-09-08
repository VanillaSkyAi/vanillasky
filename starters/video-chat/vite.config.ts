import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Mount the SDK's single video-chat endpoint on the Vite development server. */
function videoChatRoutes(): Plugin {
  return {
    name: "video-chat-routes",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        const path = url.pathname;
        if (path !== "/api/video-chat") return next();
        const action = url.searchParams.get("action");

        const startedAt = Date.now();
        const since = () => `${String(Date.now() - startedAt).padStart(6)}ms`;
        const client = new AbortController();
        request.once("aborted", () => client.abort("client disconnected"));
        response.once("close", () => {
          if (!response.writableEnded) client.abort("client disconnected");
        });
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(chunk as Buffer);
          const routes = await server.ssrLoadModule("/server.ts");
          const raw = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
            else if (value != null) headers.set(name, value);
          }
          headers.delete("content-length");
          const incoming = new Request(`http://localhost${request.url}`, {
            method: request.method,
            headers,
            signal: client.signal,
            ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: raw }),
          });
          const result: Response = await routes.handleVideoChat(incoming);
          response.statusCode = result.status;
          result.headers.forEach((value, key) => response.setHeader(key, value));
          if (!result.body) return void response.end();

          const streamsEvents = result.headers.get("content-type")?.includes("text/event-stream") === true;
          if (streamsEvents) {
            response.setHeader("cache-control", "no-cache, no-transform");
            response.flushHeaders();
            response.socket?.setNoDelay(true);
          }
          let firstChunk = true;
          for await (const chunk of result.body as unknown as AsyncIterable<Uint8Array>) {
            if (firstChunk) {
              firstChunk = false;
              server.config.logger.info(`[video-chat] ${since()}  ${action ?? "unknown"} first byte`);
            }
            response.write(chunk);
          }
          server.config.logger.info(`[video-chat] ${since()}  ${action ?? "unknown"} complete`);
          response.end();
        } catch {
          server.config.logger.error(`[video-chat] ${action ?? "unknown"} failed`);
          if (!response.headersSent) response.statusCode = 500;
          response.end("Video chat request failed");
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const localEnvironment = loadEnv(mode, process.cwd(), "");
  for (const [name, value] of Object.entries(localEnvironment)) process.env[name] ??= value;
  return { plugins: [react(), videoChatRoutes()] };
});
