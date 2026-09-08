import identity from "../build-identity.json";

export function onRequest({ request }) {
  const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
  return Response.json(identity, { headers });
}
