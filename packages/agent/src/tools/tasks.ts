import { archiveAgentMissionTask, createAgentMissionTask, getAgentMissionTask, listAgentMissionProjects, listAgentMissionTasks, slugifyMissionProjectName, updateAgentMissionTask, type AgentMissionProject, type AgentMissionTask, type CreateAgentMissionTaskInput, type UpdateAgentMissionTaskInput } from "@me3-core/plugin-mission-control";
import { domainTool, ok, optionalString, requiredString, resultOrThrow } from "./common";
import { approval, rememberTargets, requireTarget } from "./targets";

export function resolveProject(projects: AgentMissionProject[], args: Record<string, unknown>): string | undefined {
  const id = optionalString(args.projectId); const name = optionalString(args.projectName)?.trim().toLocaleLowerCase();
  if (!id && !name) return undefined;
  const candidates = projects.filter(project => (!id || project.id === id) && (!name || project.name.toLocaleLowerCase() === name || project.slug === slugifyMissionProjectName(name)));
  if (candidates.length !== 1) throw new Error("Project is ambiguous or not found. List projects and use one stable project ID.");
  return candidates[0].id;
}
export function taskTools() {
  return [
    domainTool("core.mission.task.list", async (args, context) => {
      const projects = await listAgentMissionProjects({ DB: context.db }, context.ownerId);
      const projectId = resolveProject(projects, args);
      const tasks = await listAgentMissionTasks({ DB: context.db }, context.ownerId, { projectId, status: optionalString(args.status) });
      return ok({ tasks, projects, ...await rememberTargets(context, "task", tasks, task => task.title) });
    }),
    domainTool("core.mission.task.read", async (args, context) => {
      const task = await getAgentMissionTask({ DB: context.db }, context.ownerId, requiredString(args.taskId, "Task ID"));
      if (!task) throw new Error("Task not found.");
      await rememberTargets(context, "task", [task], value => value.title); return ok({ task });
    }),
    domainTool("core.mission.task.create", async (args, context) => {
      const projectId = resolveProject(await listAgentMissionProjects({ DB: context.db }, context.ownerId), args);
      context.signal.throwIfAborted();
      const task = resultOrThrow(await createAgentMissionTask({ DB: context.db }, context.ownerId, { ...args as CreateAgentMissionTaskInput, projectId, idempotencyKey: context.idempotencyKey }));
      await rememberTargets(context, "task", [task], value => value.title); return ok({ task });
    }),
    domainTool("core.mission.task.update", async (args, context) => {
      const taskId = requiredString(args.taskId, "Task ID");
      const expected = await requireTarget<AgentMissionTask>(context, "task", taskId);
      if (args.clearDescription && args.description !== undefined || args.clearDueAt && args.dueAt !== undefined) throw new Error("Cannot set and clear the same task field.");
      const updates: UpdateAgentMissionTaskInput = { ...args as UpdateAgentMissionTaskInput, projectId: resolveProject(await listAgentMissionProjects({ DB: context.db }, context.ownerId), args), description: args.clearDescription ? null : optionalString(args.description), dueAt: args.clearDueAt ? null : optionalString(args.dueAt) };
      if (!Object.entries(updates).some(([key, value]) => key !== "taskId" && value !== undefined && !key.startsWith("clear") && key !== "projectName")) throw new Error("Task update requires a field to change.");
      context.signal.throwIfAborted();
      const task = resultOrThrow(await updateAgentMissionTask({ DB: context.db }, context.ownerId, updates, expected));
      await rememberTargets(context, "task", [task], value => value.title); return ok({ task });
    }),
    domainTool("core.mission.task.archive", async (args, context) => {
      const id = requiredString(args.taskId, "Task ID"); const expected = await requireTarget<AgentMissionTask>(context, "task", id);
      const pending = approval(context, "Archive task", expected.title, { target: expected, targetDomain: "task" });
      if (pending) return pending;
      context.signal.throwIfAborted();
      return ok({ task: resultOrThrow(await archiveAgentMissionTask({ DB: context.db }, context.ownerId, id, expected)), archived: true });
    }, { effect: "destructive", approval: "required" }),
  ];
}
