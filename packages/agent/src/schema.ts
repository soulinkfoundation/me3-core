import type { JsonSchema } from "./types";

export function validateArguments(schema: JsonSchema, value: unknown, path = "arguments"): string | null {
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(part => !validateArguments(part as JsonSchema, value, path)) ? null : `${path} does not match any allowed shape`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(", ")}`;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type && !types.some(type => type === "null" ? value === null : type === "array" ? Array.isArray(value) : type === "object" ? Boolean(value && typeof value === "object" && !Array.isArray(value)) : type === "integer" ? Number.isInteger(value) : typeof value === type)) return `${path} has the wrong type`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in object)) return `${path}.${key} is required`;
    for (const [key, child] of Object.entries(object)) {
      if (!(key in properties) && schema.additionalProperties === false) return `${path}.${key} is not allowed`;
      if (properties[key]) { const error = validateArguments(properties[key], child, `${path}.${key}`); if (error) return error; }
    }
  }
  if (Array.isArray(value) && schema.items) {
    for (let i = 0; i < value.length; i++) { const error = validateArguments(schema.items as JsonSchema, value[i], `${path}[${i}]`); if (error) return error; }
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path} is too short`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path} is too long`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return `${path} has an invalid format`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `${path} must be finite`;
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${path} is too small`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${path} is too large`;
  }
  return null;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export async function toolIdempotencyKey(ownerId: string, requestId: string, name: string, args: Record<string, unknown>): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson({ ownerId, requestId, name, args })));
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
