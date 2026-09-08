import { verifyOwner } from "./_video-chat/owner.mjs";

// Cloudflare Access protects only this login path. The public experience stays
// open; the API independently verifies the same signed identity cookie.
export async function onRequest({ request, env, fetcher }) {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return new Response("Method not allowed", {status:405,headers});
  if (!await verifyOwner(request, env, { fetcher })) {
    return new Response("Owner access is unavailable. Sign in with the approved account.", {status:403,headers});
  }
  return new Response(null, {status:302,headers:{...headers,location:"/"}});
}
