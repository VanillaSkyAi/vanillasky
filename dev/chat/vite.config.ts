import { defineConfig } from "vite";
import { Readable } from "node:stream";
import { createOfflineChatHandler, readFixtureOptions } from "./offline";
export default defineConfig({
  define: { __CHAT_LIVE_ENDPOINT__: JSON.stringify(process.env.VANILLASKY_CHAT_LIVE_ENDPOINT ?? "") },
  server: {host: "127.0.0.1", port: 4281, strictPort: true},
  plugins: [{name: "offline-chat-handler", configureServer(server) {
    server.middlewares.use(async (incoming, outgoing, next) => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1:4281");
      if (url.pathname !== "/__chat/offline") {next(); return;}
      const controller = new AbortController();
      outgoing.on("close", () => controller.abort());
      try {
        const chunks: Buffer[] = []; let length = 0;
        for await (const chunk of incoming) {
          const buffer = Buffer.from(chunk); length += buffer.length;
          if (length > 1_048_576) {outgoing.writeHead(413).end(); return;}
          chunks.push(buffer);
        }
        const body = Buffer.concat(chunks);
        const request = new Request(url, {method: incoming.method, headers: {"content-type": "application/json"}, signal: controller.signal, ...(body.length ? {body} : {})});
        const response = await createOfflineChatHandler(readFixtureOptions(url), url.origin)(request);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(outgoing);
        else outgoing.end();
      } catch {
        if (!outgoing.headersSent) outgoing.writeHead(500, {"content-type": "text/plain"});
        outgoing.end("Offline fixture failed");
      }
    });
  }}],
});
