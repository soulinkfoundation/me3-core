import { createAgentLandingPageDraft, listAgentLandingPageDesigns, listAgentLandingPages, readAgentLandingPageRevision, updateAgentLandingPageDraft, type AgentLandingPageDraftInput, type AgentLandingPageUpdateInput } from "../../../agent-chat/src/landing-pages";
import { readAgentSiteBlogPosts } from "../../../agent-chat/src/site-blog";
import { searchAgentOwnerContent, type AgentOwnerContentSearchInput } from "../../../agent-chat/src/owner-content-search";
import { listAgentMissionProjects } from "@me3-core/plugin-mission-control";
import { domainTool, ok, optionalString, requiredString, services } from "./common";
import { rememberTargets, requireTarget } from "./targets";
import { resolveProject } from "./tasks";

export function siteTools() {
  return [
    domainTool("core.sites.landing_page.designs", async () => ok({ designs: listAgentLandingPageDesigns() })),
    domainTool("core.sites.landing_page.list", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      const pages = await listAgentLandingPages(env, context.ownerId, optionalString(args.site));
      await rememberTargets(context, "landing page", await Promise.all(pages.map(page => readAgentLandingPageRevision(env, context.ownerId, page.id))));
      return ok({ pages });
    }),
    domainTool("core.sites.landing_page.create", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      const page = await createAgentLandingPageDraft(env, context.ownerId, args as AgentLandingPageDraftInput);
      await rememberTargets(context, "landing page", [await readAgentLandingPageRevision(env, context.ownerId, page.id)]);
      return ok({ page, published: false });
    }),
    domainTool("core.sites.landing_page.update", async (args, context) => {
      const env = services(context).landingPageEnv || { DB: context.db };
      const id = requiredString(args.pageId, "Page ID");
      const expected = await requireTarget<{ id: string; draftJson: string; updatedAt: string; siteUsername: string }>(context, "landing page", id);
      const page = await updateAgentLandingPageDraft(env, context.ownerId, { ...args as AgentLandingPageUpdateInput, site: expected.siteUsername }, expected);
      await rememberTargets(context, "landing page", [await readAgentLandingPageRevision(env, context.ownerId, page.id)]);
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
      const projectId = args.projectId || args.projectName ? resolveProject(await listAgentMissionProjects({ DB: context.db }, context.ownerId), args) : undefined;
      const result = await searchAgentOwnerContent(context.db, context.ownerId, { ...args as AgentOwnerContentSearchInput, sourceType, projectId });
      const selection = await rememberTargets(context, "owner content", result.results.map(record => ({ ...record, id: `${record.sourceType}:${record.sourceId}` })));
      return { status: result.ambiguous ? "needs_selection" : "ok", data: { ...result, ...selection } };
    }),
  ];
}
