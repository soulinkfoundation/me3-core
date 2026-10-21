import { createAgentLandingPageDraft, listAgentLandingPageDesigns, listAgentLandingPages, readAgentLandingPageRevision, updateAgentLandingPageDraft, type AgentLandingPageDraftInput, type AgentLandingPageUpdateInput } from "../../../agent-chat/src/landing-pages";
import { readAgentSiteBlogPosts } from "../../../agent-chat/src/site-blog";
import { searchAgentOwnerContent, type AgentOwnerContentSearchInput } from "../../../agent-chat/src/owner-content-search";
import { listAgentMissionProjects } from "@me3-core/plugin-mission-control";
import { domainTool, ok, optionalString, requiredString, services } from "./common";
import { rememberTargets, requireTarget } from "./targets";
import { resolveProject } from "./tasks";
import { requireEnabledPlugin } from "../plugin-authorization";

export function siteTools() {
  return [
    // The owner's first site in one call. The approval card is the draft card: approving it publishes
    // whatever the source holds by then (theme switches and editor changes included), through the same
    // pipeline as the web wizard. Declining leaves the draft in the editor.
    domainTool("core.sites.starter.draft", async (args, context) => {
      const service = services(context).sites;
      if (!service) throw new Error("Site drafting is unavailable on this installation.");
      if (!context.approved) {
        const draft = await service.draft(args);
        return { status: "needs_approval", approval: {
          kind: "site_draft", title: "Publish your website", summary: `${draft.name} at ${draft.publicUrl.replace(/^https?:\/\//, "")}`, ...draft,
          howItWorks: draft.hasPhoto
            ? "Nothing is live until you publish. Edit anything first; the free clarity call, newsletter and look can all change later."
            : "Nothing is live until you publish. Add your photo first, then publish; the free clarity call, newsletter and look can all change later.",
        } };
      }
      context.signal.throwIfAborted();
      const published = await service.publish();
      const photoTip = published.hasPhoto ? "" : " End with one tip: add a photo so people recognise you.";
      return ok({ ...published, clarityCall: "Free 30-minute clarity call", next: `In one or two sentences tell the owner they're live (not a draft), with the link, and that people and the AI assistants they use can now find them and book the free 30-minute clarity call. Offer to show them by having an assistant find and book them.${photoTip} Suggest nothing else (no emails, campaigns or posts). Do not mention the Mission.` });
    }),
    domainTool("core.sites.landing_page.designs", async () => ok({ designs: listAgentLandingPageDesigns() })),
    domainTool("core.sites.landing_page.list", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      const pages = await listAgentLandingPages(env, context.ownerId, optionalString(args.site));
      await rememberTargets(context, "landing page", await Promise.all(pages.map(page => readAgentLandingPageRevision(env, context.ownerId, page.id))), record => pages.find(page => page.id === record.id)?.title);
      return ok({ pages });
    }),
    domainTool("core.sites.landing_page.create", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      context.signal.throwIfAborted();
      const page = await createAgentLandingPageDraft(env, context.ownerId, args as AgentLandingPageDraftInput);
      await rememberTargets(context, "landing page", [await readAgentLandingPageRevision(env, context.ownerId, page.id)], () => page.title);
      return ok({ page, published: false });
    }),
    domainTool("core.sites.landing_page.update", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      const id = requiredString(args.pageId, "Page ID");
      const expected = await requireTarget<{ id: string; draftJson: string; updatedAt: string; siteUsername: string }>(context, "landing page", id);
      context.signal.throwIfAborted();
      const page = await updateAgentLandingPageDraft(env, context.ownerId, { ...args as AgentLandingPageUpdateInput, site: expected.siteUsername }, expected);
      await rememberTargets(context, "landing page", [await readAgentLandingPageRevision(env, context.ownerId, page.id)], () => page.title);
      return ok({ page, published: false });
    }),
    domainTool("core.sites.blog_post.read", async (args, context) => {
      const result = await readAgentSiteBlogPosts({ DB: context.db }, context.ownerId, args);
      return result.ok ? ok(result) : { status: result.candidates?.length ? "needs_selection" : "error", error: result.error, data: result };
    }),
    domainTool("core.owner_content.search", async (args, context) => {
      const journalEnabled = context.enabledPluginIds.has("me3.journal"); const tasksEnabled = context.enabledPluginIds.has("me3.mission-control");
      let sourceType = (args.sourceType || "all") as AgentOwnerContentSearchInput["sourceType"];
      if (sourceType === "journal" && !journalEnabled || sourceType === "mission_task" && !tasksEnabled || !journalEnabled && !tasksEnabled) throw new Error("Requested content plugin must be installed and enabled.");
      if (sourceType === "all" && !journalEnabled) sourceType = "mission_task";
      if (sourceType === "all" && !tasksEnabled) sourceType = "journal";
      const dependencies = sourceType === "all" ? ["me3.journal", "me3.mission-control"] : [sourceType === "journal" ? "me3.journal" : "me3.mission-control"];
      if ((args.projectId || args.projectName) && !dependencies.includes("me3.mission-control")) dependencies.push("me3.mission-control");
      const requireSources = async () => {
        for (const plugin of dependencies) await requireEnabledPlugin(context, plugin);
        context.signal.throwIfAborted();
      };
      await requireSources();
      const projectId = args.projectId || args.projectName ? resolveProject(await listAgentMissionProjects({ DB: context.db }, context.ownerId), args) : undefined;
      const result = await searchAgentOwnerContent(context.db, context.ownerId, { ...args as AgentOwnerContentSearchInput, sourceType, projectId });
      await requireSources();
      const selection = await rememberTargets(context, "owner content", result.results.map(record => ({ ...record, id: `${record.sourceType}:${record.sourceId}` })));
      return { status: result.ambiguous ? "needs_selection" : "ok", data: { ...result, ...selection } };
    }),
  ];
}
