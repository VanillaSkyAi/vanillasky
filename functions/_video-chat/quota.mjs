// One conditional INSERT is the admission decision. D1 serializes writes;
// no read/check/write race and no per-isolate counters or eventual KV writes.
// Normal conversation uses throughput limits only. Units remain accounting data;
// the separate fal ledger owns the paid video preview allowance.
export const RESERVE_SQL = `INSERT INTO video_chat_requests(id, actor, created, expires, units)
SELECT ?, ?, ?, ?, ? WHERE
 (SELECT COUNT(*) FROM video_chat_requests WHERE actor = ? AND created >= ?) < 20
 AND (SELECT COUNT(*) FROM video_chat_requests WHERE released = 0 AND expires > ?) < 12
 AND (SELECT COUNT(*) FROM video_chat_requests WHERE actor = ? AND released = 0 AND expires > ?) < 4`;
export async function reserveQuota(db, actor, units, now = Date.now()) {
  const id = crypto.randomUUID();
  const result = await db
    .prepare(RESERVE_SQL)
    .bind(
      id,
      actor,
      now,
      now + 180000,
      units,
      actor,
      now - 60000,
      now,
      actor,
      now,
    )
    .run();
  return result.meta?.changes === 1 ? id : null;
}
export async function releaseQuota(db, id) {
  await db
    .prepare("UPDATE video_chat_requests SET released = 1 WHERE id = ?")
    .bind(id)
    .run();
}
export async function actorHash(ip, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(ip),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
