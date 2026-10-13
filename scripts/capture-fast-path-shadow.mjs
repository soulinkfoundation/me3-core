import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const parse = value => typeof value === "string" ? JSON.parse(value) : value ?? null;
export async function captureShadow({ accountId, databaseId, apiToken, since, until = new Date().toISOString(), fetch: send = fetch }) {
  if (!accountId || !databaseId || !apiToken || !Number.isFinite(Date.parse(since)) || !Number.isFinite(Date.parse(until)) || Date.parse(since) >= Date.parse(until)) throw new Error("An account, database, token and valid collection window are required.");
  const query = async (sql, params) => {
    const response = await send(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`, {
      method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Array.isArray(body.result?.[0]?.results)) throw new Error(`Shadow capture query failed (HTTP ${response.status}).`);
    return body.result[0].results;
  };
  const pages = async sql => {
    const rows = [];
    for (let offset = 0; ; offset += 250) {
      const batch = await query(`${sql} LIMIT 250 OFFSET ?`, [since, until, offset]);
      rows.push(...batch); if (batch.length < 250) return rows;
    }
  };
  const turns = await pages(`SELECT turn_id AS turnId,status,created_at AS createdAt,
    json_extract(input_json,'$.messageText') AS messageText,
    json_extract(trace_json,'$.fastPath') AS fastPath,
    json_extract(trace_json,'$.modelSteps') AS modelSteps
    FROM me3_agent_turns WHERE datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?) ORDER BY created_at,turn_id`);
  const events = await pages(`SELECT id,model,estimated_cost_usd,metadata_json,created_at AS createdAt,
    json_extract(metadata_json,'$.me3_turn_id') AS turnId
    FROM ai_usage_events WHERE kind='text' AND json_extract(metadata_json,'$.me3_runtime')='agent'
    AND datetime(created_at)>=datetime(?) AND datetime(created_at)<datetime(?) ORDER BY created_at,id`);
  return { schemaVersion: "me3-fast-path-shadow-v1", collectedAt: new Date().toISOString(), since, until,
    turns: turns.map(row => ({ ...row, fastPath: parse(row.fastPath), modelSteps: parse(row.modelSteps) ?? [] })),
    usageEvents: events.map(row => {
      const metadata = parse(row.metadata_json);
      return { id: row.id, turnId: row.turnId, model: row.model, createdAt: row.createdAt,
        costUsd: metadata?.costKnown === true && Number.isFinite(row.estimated_cost_usd) ? row.estimated_cost_usd : null,
        measurement: metadata?.shadowRequest ?? null };
    }) };
}
async function main() {
  const since = process.argv.find(arg => arg.startsWith("--since="))?.slice(8);
  const directory = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? ".me3-evals/fast-path/shadow");
  execFileSync("git", ["check-ignore", "--quiet", resolve(directory, "capture.json")]);
  const capture = await captureShadow({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID, databaseId: process.env.ME3_SHADOW_DATABASE_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AUTH_TOKEN, since });
  mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, "capture.json"), JSON.stringify(capture, null, 2) + "\n");
  console.log(`Private shadow capture saved: ${resolve(directory, "capture.json")} (${capture.turns.length} turns).`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
