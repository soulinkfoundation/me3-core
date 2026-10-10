import { Agent, type FiberRecoveryContext } from "agents";
import { AgentInputConflictError, appendAgentStreamEvent, createD1TurnStore, persistAgentApprovalReply, persistAgentInput, persistAgentRequestAlias, isAgentCancellationRequested, requestAgentCancellation } from "../../../packages/agent/src/store";
import { executeNewAgentTurn, isNewAgentDispatchInput, type NewAgentDispatchInput } from "./agent-runtime";
import { resolvePrimaryAssistantThread } from "./assistant-primary-thread";
import { revalidateAgentImagePayload } from "./agent-image-projection";
import type { Env } from "./types";

type StreamEvent={event:string;data:Record<string,unknown>;seq:number};
type Subscriber={controller:ReadableStreamDefaultController<Uint8Array>;lastSeq:number;initializing:boolean;closed:boolean;remove():void;queued:StreamEvent[]};
type SavedTurn={owner_id:string;thread_id:string;turn_id:string;request_id:string;input_json:string;status:string;response_json:string|null};

/** Fibers/DO state are execution caches; D1 owns inputs, checkpoints and SSE replay. */
export class Me3Agent extends Agent<Env> {
  // The recovery hook awaits a turn whose cooperative time budget is five minutes.
  static override options={fiberRecoveryHookTimeoutMs:330_000};
  private readonly subscribers=new Map<string,Set<Subscriber>>();
  private readonly active=new Map<string,{fiberId:string;controller:AbortController}>();

  override async onRequest(request:Request):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==="/health")return Response.json({ok:true,service:"me3-agent",runtime:"agent",canonicalStore:"D1"});
    if(request.method==="POST"&&url.pathname==="/managed-lifecycle/purge-storage") {
      const installation=request.headers.get("X-ME3-Managed-Installation");
      if(!installation||!/^mi-[0-9a-f]{16}$/.test(installation)||installation!==this.env.ME3_MANAGED_INSTALLATION_ID)return Response.json({ok:false,error:"Not found"},{status:404});
      if(this.active.size)return Response.json({ok:false,error:"Agent turns are still active"},{status:409});
      await this.ctx.storage.deleteAll();
      return Response.json({ok:true,purged:(await this.ctx.storage.list({limit:1})).size===0});
    }
    if(request.method!=="POST")return Response.json({error:"Not found"},{status:404});
    const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if(url.pathname==="/turn/cancel")return this.cancel(body);
    if(url.pathname==="/turn/resume") {
      if(typeof body?.userId!=="string"||typeof body.turnId!=="string")return Response.json({error:"Invalid turn identity"},{status:400});
      const row=await this.loadTurn(body.userId,body.turnId);
      if(!row)return Response.json({error:"Turn not found"},{status:404});
      const input=JSON.parse(row.input_json) as NewAgentDispatchInput;
      await this.prepareResume(input);
      await this.startTurn(input,true);
      return Response.json(await this.readResponse(input));
    }
    if(!["/dispatch/sandbox","/dispatch/sandbox/stream"].includes(url.pathname)||!isNewAgentDispatchInput(body))return Response.json({error:"Invalid agent dispatch payload"},{status:400});
    let input=body;
    if(!input.threadId)input={...input,threadId:(await resolvePrimaryAssistantThread(this.env,input.userId)).id};
    const thread=await this.env.DB.prepare("SELECT id FROM assistant_threads WHERE owner_id=? AND id=? AND status='active'").bind(input.userId,input.threadId).first();
    if(!thread)return Response.json({error:"Conversation not found"},{status:404});
    try {
      input=await this.resolveChatApproval(input);
      await persistAgentInput(this.env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId},input);
    }
    catch(error){if(error instanceof AgentInputConflictError)return Response.json({ok:false,error:error.message},{status:409});throw error;}
    // Retries cannot replace the first saved input, even before a checkpoint exists.
    input=JSON.parse((await this.loadTurn(input.userId,input.turnId))!.input_json) as NewAgentDispatchInput;
    await this.prepareResume(input);
    if(url.pathname.endsWith("/stream")) {
      const response=this.subscribe(input,Number(request.headers.get("Last-Event-ID")||0));
      await this.startTurn(input,false);
      return response;
    }
    await this.startTurn(input,true);
    return Response.json(await this.readResponse(input));
  }

  override async onFiberRecovered(context:FiberRecoveryContext) {
    // Managed fibers can be evicted after the ledger insert but before stash().
    const snapshot=(context.snapshot??context.metadata) as {ownerId?:string;turnId?:string}|null;
    if(!snapshot?.ownerId||!snapshot.turnId)return {status:"error" as const,error:"Missing D1 turn identity"};
    const row=await this.loadTurn(snapshot.ownerId,snapshot.turnId);
    if(!row?.input_json)return {status:"error" as const,error:"Canonical turn is unavailable"};
    const input=JSON.parse(row.input_json) as NewAgentDispatchInput;
    if(row.response_json&&["complete","failed","cancelled"].includes(row.status))return {status:"completed" as const};
    await this.prepareResume(input);
    await this.executeTurn(input,context.id);
    return {status:"completed" as const};
  }

  private async startTurn(input:NewAgentDispatchInput,waitForCompletion:boolean) {
    if(await this.stopRequested(input))return;
    const active=this.active.get(input.turnId);
    // The checkpoint may be terminal while the fiber is still persisting its response.
    if(active){if(waitForCompletion)await this.startFiber("assistant-turn",async()=>{}, {fiberId:active.fiberId,idempotencyKey:active.fiberId,waitForCompletion:true});return;}
    const row=await this.loadTurn(input.userId,input.turnId);
    if(row?.response_json&&["complete","failed","cancelled"].includes(row.status))return;
    const store=this.store(input),checkpoint=await store.load();
    const decision=checkpoint?.approvalId?await store.approvalDecision(checkpoint.approvalId):null;
    if(checkpoint?.status==="needs_approval"&&decision==="pending")return;
    const suffix=checkpoint?.approvalId?`:approval:${checkpoint.approvalId}:${decision}`:row?.status==="complete"?":response":"";
    const fiberId=`${input.turnId}${suffix}`;
    await this.startFiber("assistant-turn",async context=>{
      context.stash({ownerId:input.userId,turnId:input.turnId});
      await this.executeTurn(input,fiberId,context.signal);
    },{fiberId,idempotencyKey:fiberId,metadata:{ownerId:input.userId,turnId:input.turnId},waitForCompletion});
  }

  private store(input:NewAgentDispatchInput) {return createD1TurnStore(this.env.DB,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId,requestId:input.requestId});}
  private async executeTurn(input:NewAgentDispatchInput,fiberId:string,signal?:AbortSignal) {
    if(await this.stopRequested(input))return;
    const row=await this.loadTurn(input.userId,input.turnId);
    if(row?.response_json&&["complete","failed","cancelled"].includes(row.status))return;
    const controller=new AbortController(),active={fiberId,controller};
    const cancel=()=>controller.abort(signal?.reason);signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
    this.active.set(input.turnId,active);
    try {await executeNewAgentTurn(this.env,input,controller.signal,(event,data,seq)=>this.broadcastTurn(input.turnId,event,data,seq));}
    catch(error){await this.persistTerminal(input,controller.signal.aborted?"cancelled":"failed",error instanceof Error?error.message:"Agent turn failed");}
    finally {signal?.removeEventListener("abort",cancel);if(controller.signal.aborted)await this.declinePending(input.userId,input.turnId);if(this.active.get(input.turnId)===active)this.active.delete(input.turnId);}
  }

  private async prepareResume(input:NewAgentDispatchInput) {
    if(await this.stopRequested(input))return;
    const store=this.store(input),checkpoint=await store.load();
    if(checkpoint?.status!=="needs_approval"||!checkpoint.approvalId)return;
    const decision=await store.approvalDecision(checkpoint.approvalId);if(decision==="pending")return;
    const active=this.active.get(input.turnId),nextFiberId=`${input.turnId}:approval:${checkpoint.approvalId}:${decision}`;
    // The approval event is published before the prior fiber saves its paused response.
    if(active&&active.fiberId!==nextFiberId)await this.startFiber("assistant-turn",async()=>{}, {fiberId:active.fiberId,idempotencyKey:active.fiberId,waitForCompletion:true});
    const updated=await this.env.DB.prepare("UPDATE me3_agent_turns SET status='running',response_json=NULL,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=? AND status='needs_approval'").bind(input.userId,input.turnId).run();
    if(updated.meta.changes){
      // A durable stage boundary prevents an old approval's done event closing a resumed stream.
      const data={state:"resuming",approvalId:checkpoint.approvalId,replaceText:true};
      this.broadcastTurn(input.turnId,"status",data,await appendAgentStreamEvent(this.env.DB,input.userId,input.turnId,"status",data));
    }
  }

  private subscribe(input:NewAgentDispatchInput,after:number):Response {
    const encoder=new TextEncoder();let subscriber:Subscriber|undefined;let heartbeat:ReturnType<typeof setInterval>|undefined;
    const remove=()=>{if(subscriber){subscriber.closed=true;const group=this.subscribers.get(input.turnId);group?.delete(subscriber);if(!group?.size)this.subscribers.delete(input.turnId);}if(heartbeat){clearInterval(heartbeat);heartbeat=undefined;}};
    const stream=new ReadableStream<Uint8Array>({
      start:async controller=>{
        subscriber={controller,lastSeq:Number.isSafeInteger(after)&&after>=0?after:0,initializing:true,closed:false,remove,queued:[]};
        let group=this.subscribers.get(input.turnId);if(!group)this.subscribers.set(input.turnId,group=new Set());group.add(subscriber);
        controller.enqueue(encoder.encode(": connected\n\n"));
        heartbeat=setInterval(()=>{try{controller.enqueue(encoder.encode(": keepalive\n\n"));}catch{remove();}},25_000);
        try {
          const history=await this.env.DB.prepare("SELECT seq,event,data_json FROM me3_agent_stream_events WHERE owner_id=? AND turn_id=? AND seq>? ORDER BY seq").bind(input.userId,input.turnId,subscriber.lastSeq).all<{seq:number;event:string;data_json:string}>();
          const replay=[...(history.results||[]).map(row=>({seq:row.seq,event:row.event,data:JSON.parse(row.data_json)})),...subscriber.queued].sort((a,b)=>a.seq-b.seq);
          if(subscriber.closed)return;
          const boundary=replay.filter(item=>item.event==="status"&&item.data.state==="resuming").at(-1)?.seq||0;
          subscriber.queued=[];
          for(const item of replay)if(item.seq>=boundary)await this.sendReplayed(subscriber,input,item);
          // Image revalidation awaits D1; keep newer events queued until replay is drained.
          while(!subscriber.closed&&subscriber.queued.length) {
            const queued=subscriber.queued.sort((a,b)=>a.seq-b.seq);subscriber.queued=[];
            for(const item of queued)await this.sendReplayed(subscriber,input,item);
          }
          subscriber.initializing=false;
          const row=await this.loadTurn(input.userId,input.turnId);
          if(row?.response_json&&!subscriber.closed&&row.status!=="running") {
            const payload=JSON.parse(row.response_json);await this.sendReplayed(subscriber,input,{event:payload.status==="failed"?"error":"done",data:payload,seq:0});
          }
        }catch(error){this.send(subscriber,"error",{ok:false,error:error instanceof Error?error.message:"Stream replay failed"},0);remove();}
      },cancel:remove,
    });
    return new Response(stream,{headers:{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform"}});
  }

  private broadcastTurn(turnId:string,event:string,data:Record<string,unknown>,seq:number) {
    for(const subscriber of this.subscribers.get(turnId)||[]) {
      if(subscriber.initializing)subscriber.queued.push({event,data,seq});else this.send(subscriber,event,data,seq);
    }
  }
  private async sendReplayed(subscriber:Subscriber,input:NewAgentDispatchInput,item:StreamEvent) {
    const data=(item.event==="done"||item.event==="error")&&item.data.imageAction
      ?await revalidateAgentImagePayload(this.env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId},item.data):item.data;
    this.send(subscriber,item.event,data,item.seq);
  }
  private send(subscriber:Subscriber,event:string,data:Record<string,unknown>,seq:number) {
    if(subscriber.closed||seq&&seq<=subscriber.lastSeq)return;
    try {
      subscriber.controller.enqueue(new TextEncoder().encode(`${seq?`id: ${seq}\n`:""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      if(seq)subscriber.lastSeq=seq;
      if(event==="done"||event==="error"){subscriber.controller.close();subscriber.remove();}
    }catch{subscriber.remove();}
  }
  private loadTurn(ownerId:string,turnId:string) {return this.env.DB.prepare("SELECT * FROM me3_agent_turns WHERE owner_id=? AND turn_id=?").bind(ownerId,turnId).first<SavedTurn>();}
  private async readResponse(input:NewAgentDispatchInput) {
    const row=await this.loadTurn(input.userId,input.turnId);
    return row?.response_json?revalidateAgentImagePayload(this.env,{ownerId:input.userId,threadId:input.threadId,turnId:input.turnId},JSON.parse(row.response_json)):{ok:false,error:"Agent turn has not completed",turnId:input.turnId};
  }

  private async cancel(body:Record<string,unknown>|null) {
    if(typeof body?.userId!=="string"||!body.userId||!(typeof body.requestId==="string"&&body.requestId.length>0&&body.requestId.length<=500||typeof body.turnId==="string"&&body.turnId.length>0))return Response.json({error:"Invalid turn identity"},{status:400});
    let row:SavedTurn|null;
    if(typeof body.requestId==="string") {
      // Persist before lookup: Stop can arrive before dispatch saves its input.
      await requestAgentCancellation(this.env.DB,body.userId,body.requestId);
      row=await this.env.DB.prepare("SELECT * FROM me3_agent_turns WHERE owner_id=? AND request_id=?").bind(body.userId,body.requestId).first<SavedTurn>();
      row??=await this.env.DB.prepare("SELECT t.* FROM me3_agent_turns t JOIN me3_agent_request_aliases a ON a.owner_id=t.owner_id AND a.turn_id=t.turn_id WHERE a.owner_id=? AND a.request_id=?").bind(body.userId,body.requestId).first<SavedTurn>();
      if(!row)return Response.json({ok:true,cancellationRequested:true,requestId:body.requestId},{status:202});
      await requestAgentCancellation(this.env.DB,row.owner_id,row.request_id);
    } else {
      row=await this.loadTurn(body.userId,body.turnId as string);if(!row)return Response.json({error:"Turn not found"},{status:404});
      await requestAgentCancellation(this.env.DB,row.owner_id,row.request_id);
    }
    if(["complete","failed","cancelled"].includes(row.status))return Response.json({ok:true,cancelled:row.status==="cancelled",turnId:row.turn_id});
    const active=this.active.get(row.turn_id);
    if(active)active.controller.abort("Owner cancelled");
    else await this.persistTerminal(JSON.parse(row.input_json) as NewAgentDispatchInput,"cancelled","Owner cancelled");
    await this.declinePending(row.owner_id,row.turn_id);
    return Response.json({ok:true,cancelled:true,turnId:row.turn_id});
  }

  private async stopRequested(input:NewAgentDispatchInput):Promise<boolean> {
    if(!await isAgentCancellationRequested(this.env.DB,input.userId,input.requestId))return false;
    this.active.get(input.turnId)?.controller.abort("Owner cancelled");
    await this.declinePending(input.userId,input.turnId);
    await this.persistTerminal(input,"cancelled","Owner cancelled");
    return true;
  }

  private async declinePending(ownerId:string,turnId:string) {await this.env.DB.prepare("UPDATE me3_agent_approvals SET status='declined',decided_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=? AND status='pending'").bind(ownerId,turnId).run();}

  private async persistTerminal(input:NewAgentDispatchInput,status:"failed"|"cancelled",error:string) {
    const row=await this.loadTurn(input.userId,input.turnId);
    if(!row||row.response_json&&(status==="failed"||["complete","failed","cancelled"].includes(row.status)))return;
    const replyText=status==="cancelled"?"The turn was cancelled before completion.":`I couldn't complete this turn: ${error}`;
    const payload={ok:false,status,turnId:input.turnId,threadId:input.threadId,replyText,...(status==="failed"?{error}:{})};
    const updated=await this.env.DB.prepare("UPDATE me3_agent_turns SET status=?,response_json=?,updated_at=CURRENT_TIMESTAMP WHERE owner_id=? AND turn_id=? AND (response_json IS NULL OR status='needs_approval')").bind(status,JSON.stringify(payload),input.userId,input.turnId).run();
    if(!updated.meta.changes)return;
    const store=this.store(input),checkpoint=await store.load();if(checkpoint){checkpoint.status=status;checkpoint.messages.push({role:"assistant",content:replyText});await store.save(checkpoint);}
    await this.env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'assistant',?,?)").bind(`${input.turnId}:assistant:${status}`,input.userId,input.threadId,replyText,JSON.stringify(payload)).run();
    const event=status==="failed"?"error":"done";
    this.broadcastTurn(input.turnId,event,payload,await appendAgentStreamEvent(this.env.DB,input.userId,input.turnId,event,payload));
  }

  private async resolveChatApproval(input:NewAgentDispatchInput):Promise<NewAgentDispatchInput> {
    const alias=await this.env.DB.prepare("SELECT turn_id FROM me3_agent_request_aliases WHERE owner_id=? AND request_id=?").bind(input.userId,input.requestId).first<{turn_id:string}>();
    if(alias) {
      await persistAgentRequestAlias(this.env.DB,input.userId,input.requestId,alias.turn_id,input);
      const saved=await this.loadTurn(input.userId,alias.turn_id);
      if(!saved)throw new AgentInputConflictError("Approved turn is unavailable");
      if(await isAgentCancellationRequested(this.env.DB,input.userId,input.requestId))await requestAgentCancellation(this.env.DB,input.userId,saved.request_id);
      return JSON.parse(saved.input_json) as NewAgentDispatchInput;
    }
    if(await isAgentCancellationRequested(this.env.DB,input.userId,input.requestId))return input;
    const reply=input.messageText.trim().toLowerCase().replace(/[.!]+$/u, "").trim();
    const decision=["approve","approved","yes","confirm"].includes(reply)?"approved":["decline","no","cancel"].includes(reply)?"declined":null;
    if(!decision)return input;
    const rows=await this.env.DB.prepare(`SELECT a.id,t.* FROM me3_agent_approvals a JOIN me3_agent_turns t ON t.turn_id=a.turn_id AND t.owner_id=a.owner_id
      WHERE a.owner_id=? AND a.thread_id=? AND a.status='pending' AND t.status='needs_approval' ORDER BY a.created_at DESC LIMIT 2`).bind(input.userId,input.threadId).all<SavedTurn&{id:string}>();
    if(rows.results?.length!==1)return input;
    const row=rows.results[0];
    const recorded=await persistAgentApprovalReply(this.env.DB,input.userId,input.requestId,row.turn_id,input,row.id,decision);
    if(await isAgentCancellationRequested(this.env.DB,input.userId,input.requestId)) {
      await requestAgentCancellation(this.env.DB,input.userId,row.request_id);
      return JSON.parse(row.input_json) as NewAgentDispatchInput;
    }
    if(!recorded)throw new AgentInputConflictError("Approval already has a different decision");
    await this.env.DB.prepare("INSERT OR IGNORE INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,?,?,'user',?,?)").bind(`${input.turnId}:approval`,input.userId,input.threadId,input.messageText,JSON.stringify({approvalId:row.id,decision,requestId:input.requestId})).run();
    return JSON.parse(row.input_json) as NewAgentDispatchInput;
  }
}
