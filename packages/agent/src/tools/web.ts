import { domainTool, ok, optionalNumber, requiredString, services } from "./common";

export function webTools() {
  return [
    domainTool("core.web.search", async (args, context) => {
      const service = services(context).web?.search;
      if (!service) throw new Error("Web search is unavailable.");
      return ok(await service({ query: requiredString(args.query, "Search query"), resultLimit: optionalNumber(args.resultLimit), freshness: args.freshnessMaxAgeSeconds === undefined ? undefined : { kind: "max_age", maxAgeSeconds: Number(args.freshnessMaxAgeSeconds) }, domainPolicy: { allowedDomains: args.allowedDomains as string[] | undefined, blockedDomains: args.blockedDomains as string[] | undefined } }));
    }),
    domainTool("core.web.open", async (args, context) => {
      const service = services(context).web?.open;
      if (!service) throw new Error("Web page retrieval is unavailable.");
      return ok(await service({ url: requiredString(args.url, "Public URL"), retrievalMode: args.retrievalMode as "auto" | "static" | undefined, maxCharacters: optionalNumber(args.maxCharacters) }));
    }),
  ];
}
