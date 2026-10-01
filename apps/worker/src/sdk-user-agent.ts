import { Agent } from "agents";
import { Me3UserAgent as CoreUserAgent } from "./user-agent";
import type { Env } from "./types";

/** The SDK owns the Durable Object lifecycle; Core keeps portable records in D1. */
export class Me3SdkUserAgent extends Agent<Env> {
  private readonly core = new CoreUserAgent(this.ctx, this.env);

  override onRequest(request: Request): Promise<Response> {
    return this.core.fetch(request);
  }
}
