import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentImageGenerationServices } from "./agent-image-generation";
import { imageDimensions } from "./site-images";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });

/** A PNG header with real dimensions; enough for the byte sniffing and size checks under test. */
function pngOf(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const scope = { threadId: "thread", turnId: "turn", requestId: "request", idempotencyKey: "edit-key", signal: new AbortController().signal };
const instruction = "Change the shirt number to 9";

type Op = { transform?: Record<string, any>; draw?: { overlay: Op[]; options: Record<string, number> } };
/** Simulated Cloudflare Images binding: records each pipeline and returns a PNG of the resulting size. */
function fakeImages() {
  const calls: Array<{ ops: Op[]; format: string; width: number; height: number }> = [];
  const pipeline = (source: ReadableStream, ops: Op[] = []): any => ({
    ops,
    transform(options: Record<string, any>) { return pipeline(source, [...ops, { transform: options }]); },
    draw(overlay: { ops: Op[] }, options: Record<string, number>) { return pipeline(source, [...ops, { draw: { overlay: overlay.ops, options } }]); },
    async output(options: { format: string }) {
      let { width, height } = imageDimensions(await new Response(source).arrayBuffer())!;
      for (const { transform } of ops) {
        if (!transform) continue;
        if (transform.trim?.width) { width = transform.trim.width; height = transform.trim.height; }
        if (transform.width && transform.height) {
          if (transform.fit === "squeeze") { width = transform.width; height = transform.height; }
          else { const scale = Math.min(1, transform.width / width, transform.height / height); width = Math.round(width * scale); height = Math.round(height * scale); }
        }
      }
      calls.push({ ops, format: options.format, width, height });
      return { response: () => new Response(pngOf(width, height).slice().buffer) };
    },
  });
  return { calls, binding: { input: (image: ReadableStream) => pipeline(image) } };
}

function fixture(options: { model?: string; output?: Uint8Array; usage?: unknown; images?: boolean; source?: Uint8Array; args?: Record<string, unknown> } = {}) {
  const model = options.model ?? "openai/gpt-image-2";
  const raw = new DatabaseSync(":memory:"); databases.push(raw); raw.exec("PRAGMA foreign_keys=ON");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  const args = options.args ?? { prompt: instruction, attachmentId: "photo" };
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic'),('other','other-synthetic');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic'),('elsewhere','owner','Elsewhere'),('foreign','other','Foreign');
    INSERT INTO me3_agent_turns(turn_id,owner_id,thread_id,request_id) VALUES('turn','owner','thread','request');
    INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key,created_at) VALUES
      ('photo','owner','thread','photo.png','image/png',33,'image','ready','assistant/owner/photo','2026-11-01 10:00:00'),
      ('other-thread','owner','elsewhere','x.png','image/png',33,'image','ready','assistant/owner/elsewhere','2026-11-01 10:00:00'),
      ('foreign-photo','other','foreign','y.png','image/png',33,'image','ready','assistant/other/photo','2026-11-01 10:00:00'),
      ('notes','owner','thread','notes.txt','text/plain',5,'text','ready','assistant/owner/notes','2026-11-01 10:00:00');`);
  raw.prepare("INSERT INTO me3_agent_tool_receipts(owner_id,idempotency_key,turn_id,tool_name,arguments_json,status) VALUES('owner','edit-key','turn','core_images_edit',?,'running')").run(JSON.stringify(args));
  const db = { prepare(sql: string) { const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...bound: unknown[]) { values = bound; return statement; }, async first() { return query.get(...values as never[]) ?? null; }, async all() { return { results: query.all(...values as never[]) }; }, async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; } }; return statement;
  }, async batch(statements: Array<{ run: () => Promise<unknown> }>) { raw.exec("BEGIN"); try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
  const source = options.source ?? pngOf(600, 1000);
  const objects = new Map<string, Uint8Array>([["assistant/owner/photo", source], ["assistant/owner/elsewhere", source], ["assistant/other/photo", source]]);
  const put = vi.fn(async (key: string, bytes: ArrayBuffer | Uint8Array) => { objects.set(key, new Uint8Array(bytes)); return {}; });
  const get = vi.fn(async (key: string) => { const bytes = objects.get(key); return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer } : null; });
  const output = options.output ?? pngOf(1024, 1536);
  const run = vi.fn(async (_model: string, _input: any, _options: unknown): Promise<unknown> => model.startsWith("@cf/") ? { image: b64(output) } : { data: [{ b64_json: b64(output) }], ...(options.usage ? { usage: options.usage } : {}) });
  const images = options.images ? fakeImages() : null;
  const env = { DB: db, AI: { run }, SITE_ASSETS: { put, get, delete: vi.fn() }, ...(images ? { IMAGES: images.binding } : {}), ME3_DEPLOYMENT_MODE: "self_hosted", ME3_AI_IMAGE_GENERATION_MODEL: model, CLOUDFLARE_AI_GATEWAY_ID: "fixture" } as unknown as Env;
  const usageRow = () => raw.prepare("SELECT estimated_cost_usd cost,metadata_json FROM ai_usage_events").get() as { cost: number; metadata_json: string } | undefined;
  return { raw, env, run, put, objects, images, usageRow, service: createAgentImageGenerationServices(env, "owner")! };
}

describe("private image edit operation", () => {
  it("sends the owner's image with the instruction and saves the result as a new attachment", async () => {
    const f = fixture();
    const result = await f.service.edit!(instruction, { ...scope, attachmentId: "photo" });
    expect(result).toMatchObject({ status: "complete", action: { kind: "generated", model: "openai/gpt-image-2", assets: [{ mimeType: "image/png", width: 1024, height: 1536 }] } });
    const [model, input] = f.run.mock.calls[0];
    expect(model).toBe("openai/gpt-image-2");
    expect(input).toMatchObject({ size: "1024x1536", images: [`data:image/png;base64,${b64(pngOf(600, 1000))}`] });
    expect(input.prompt).toContain(instruction);
    // The source is read, never replaced.
    expect(f.objects.get("assistant/owner/photo")).toEqual(pngOf(600, 1000));
    expect(f.raw.prepare("SELECT COUNT(*) count FROM assistant_attachments WHERE thread_id='thread' AND kind='image'").get()).toMatchObject({ count: 2 });
    expect(JSON.parse(String(f.raw.prepare("SELECT metadata_json FROM assistant_attachments WHERE id LIKE 'agent-image:%'").get()!.metadata_json))).toMatchObject({ generated: true, editedFrom: "photo" });
    expect(f.raw.prepare("SELECT status FROM me3_agent_tool_receipts WHERE tool_name='core_images_edit'").get()).toMatchObject({ status: "finished" });
    expect(await f.service.edit!(instruction, { ...scope, attachmentId: "photo" })).toEqual(result);
    expect(f.run).toHaveBeenCalledTimes(1);
  });

  it("edits the newest image in the conversation when none is named", async () => {
    const f = fixture({ args: { prompt: instruction } });
    f.raw.exec("INSERT INTO assistant_attachments(id,owner_id,thread_id,filename,mime_type,size,kind,status,storage_key,created_at) VALUES('newer','owner','thread','newer.png','image/png',33,'image','ready','assistant/owner/newer','2026-11-02 10:00:00')");
    f.objects.set("assistant/owner/newer", pngOf(1000, 1000));
    expect(await f.service.edit!(instruction, scope)).toMatchObject({ status: "complete" });
    expect(f.run.mock.calls[0][1]).toMatchObject({ size: "1024x1024", images: [`data:image/png;base64,${b64(pngOf(1000, 1000))}`] });
    expect(JSON.parse(String(f.raw.prepare("SELECT metadata_json FROM assistant_attachments WHERE id LIKE 'agent-image:%'").get()!.metadata_json))).toMatchObject({ editedFrom: "newer" });
  });

  it.each(["other-thread", "foreign-photo", "notes", "missing", "deleted", "stored-object-gone", "receipt-names-another-image"])("refuses before the provider or a reservation: %s", async bad => {
    const attachmentId = ["deleted", "stored-object-gone", "receipt-names-another-image"].includes(bad) ? "photo" : bad;
    const f = fixture({ args: { prompt: instruction, attachmentId: bad === "receipt-names-another-image" ? "other-thread" : attachmentId } });
    if (bad === "deleted") f.raw.exec("UPDATE assistant_attachments SET status='deleted' WHERE id='photo'");
    if (bad === "stored-object-gone") f.objects.delete("assistant/owner/photo");
    expect(await f.service.edit!(instruction, { ...scope, attachmentId })).toMatchObject({ status: "failed" });
    expect(f.run).not.toHaveBeenCalled(); expect(f.put).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) count FROM ai_usage_events").get()).toMatchObject({ count: 0 });
    expect(f.raw.prepare("SELECT COUNT(*) count FROM me3_agent_image_operations").get()).toMatchObject({ count: 0 });
  });

  it("redraws only the named region and pastes it back into the untouched photo", async () => {
    const region = { x: 0.4, y: 0.5, width: 0.1, height: 0.1 };
    const f = fixture({ images: true, source: pngOf(2000, 3000), output: pngOf(1024, 1024), args: { prompt: instruction, attachmentId: "photo", region } });
    const result = await f.service.edit!(instruction, { ...scope, attachmentId: "photo", region });
    // The saved image keeps the photo's own size; only a patch of it came from the model.
    expect(result).toMatchObject({ status: "complete", action: { assets: [{ width: 2000, height: 3000 }] } });
    const calls = f.images!.calls;
    // The model sees a square of context around the region, not the whole photo.
    const crop = calls.find(call => call.ops.some(op => op.transform?.trim) && !call.ops.some(op => op.draw))!;
    expect(crop.ops[0].transform!.trim).toEqual({ left: 413, top: 1163, width: 975, height: 975 });
    expect(f.run.mock.calls[0][1]).toMatchObject({ size: "1024x1024", images: [`data:image/png;base64,${b64(pngOf(975, 975))}`] });
    // The region plus a margin is cut from the model's square and drawn at its original position.
    const paste = calls.find(call => call.ops.some(op => op.draw))!;
    const draw = paste.ops.find(op => op.draw)!.draw!;
    expect(draw.options).toEqual({ left: 755, top: 1455 });
    expect(draw.overlay[0].transform!.trim).toEqual({ left: 359, top: 307, width: 305, height: 410 });
    expect(draw.overlay[1].transform).toMatchObject({ width: 290, height: 390, fit: "squeeze" });
    expect(JSON.parse(String(f.raw.prepare("SELECT metadata_json FROM assistant_attachments WHERE id LIKE 'agent-image:%'").get()!.metadata_json))).toMatchObject({ editedFrom: "photo", region });
  });

  it("refuses a region edit it cannot composite rather than redrawing the whole photo", async () => {
    const region = { x: 0.4, y: 0.5, width: 0.1, height: 0.1 };
    const f = fixture({ args: { prompt: instruction, attachmentId: "photo", region } });
    expect(await f.service.edit!(instruction, { ...scope, attachmentId: "photo", region })).toMatchObject({ status: "failed" });
    expect(f.run).not.toHaveBeenCalled();
  });

  it("sends FLUX.2 a reference image no larger than its input limit", async () => {
    const f = fixture({ model: "@cf/black-forest-labs/flux-2-klein-4b", images: true, source: pngOf(2000, 2000), output: pngOf(1024, 1024) });
    expect(await f.service.edit!(instruction, { ...scope, attachmentId: "photo" })).toMatchObject({ status: "complete" });
    const { multipart } = f.run.mock.calls[0][1];
    const form = await new Response(multipart.body, { headers: { "content-type": multipart.contentType } }).formData();
    expect(form.get("width")).toBe("1024"); expect(form.get("height")).toBe("1024"); expect(String(form.get("prompt"))).toContain(instruction);
    const reference = imageDimensions(await (form.get("input_image_0") as File).arrayBuffer())!;
    expect(Math.max(reference.width, reference.height)).toBeLessThan(512);
    // Four output tiles plus one input tile.
    expect(f.usageRow()!.cost).toBeCloseTo(4 * 0.000287 + 0.000059, 9);
    expect(JSON.parse(f.usageRow()!.metadata_json)).toMatchObject({ costKnown: true });
  });

  it("refuses a FLUX.2 edit without the Images binding it needs to shrink the reference", async () => {
    const f = fixture({ model: "@cf/black-forest-labs/flux-2-klein-4b" });
    expect(await f.service.edit!(instruction, { ...scope, attachmentId: "photo" })).toMatchObject({ status: "failed" });
    expect(f.run).not.toHaveBeenCalled();
  });

  it("prices reported image-input tokens, and estimates when the provider reports none", async () => {
    const reported = fixture({ usage: { input_tokens: 510, output_tokens: 1800, total_tokens: 2310, input_tokens_details: { text_tokens: 10, image_tokens: 500 } } });
    await reported.service.edit!(instruction, { ...scope, attachmentId: "photo" });
    expect(reported.usageRow()!.cost).toBeCloseTo((10 * 5 + 500 * 8 + 1800 * 30) / 1_000_000, 9);
    expect(JSON.parse(reported.usageRow()!.metadata_json)).toMatchObject({ costKnown: true, usageReported: true });
    const estimated = fixture();
    await estimated.service.edit!(instruction, { ...scope, attachmentId: "photo" });
    // A 1024x1536 output is 1.5 squares, plus the input-image allowance.
    expect(estimated.usageRow()!.cost).toBeCloseTo(0.053 * 1.5 + 0.02, 9);
    expect(JSON.parse(estimated.usageRow()!.metadata_json)).toMatchObject({ costKnown: true, usageReported: false });
  });

  it("holds accounting when the output is not the size that was requested and priced", async () => {
    const f = fixture({ output: pngOf(1024, 1024) });
    expect(await f.service.edit!(instruction, { ...scope, attachmentId: "photo" })).toMatchObject({ status: "complete" });
    expect(JSON.parse(f.usageRow()!.metadata_json)).toMatchObject({ costKnown: false });
  });
});
