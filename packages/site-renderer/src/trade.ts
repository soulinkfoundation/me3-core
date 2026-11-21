/** A trade is one short plain line, as me.json publishes it. */
export const TRADE_MAX_LENGTH = 60;

function plainLine(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The first clause of a headline, at most five words: "Career coach", not "Career coach helping people who…".
 * It is what someone would type to find this owner.
 */
export function headlineTrade(headline: string): string {
  return (plainLine(headline).split(/\s*[·•|–—,]\s*|\s+-\s+|\s+(?:helping|for|who|that|with)\s+/i)[0] || "").trim().split(/\s+/).slice(0, 5).join(" ");
}

/**
 * What the owner does, in a few words people search for. Their own words when they gave them; otherwise the
 * headline a starter site saved as the bio's bold first line; otherwise nothing, rather than a guess.
 */
export function publicTrade(profile: { trade?: unknown; bio?: unknown }): string | undefined {
  const stated = typeof profile.trade === "string" ? plainLine(profile.trade) : "";
  const bio = typeof profile.bio === "string" ? profile.bio : "";
  const headline = /^\s*\*\*(.+?)\*\*/.exec(bio)?.[1] || /^\s*(?:<p[^>]*>\s*)?<(strong|b)>(.+?)<\/\1>/i.exec(bio)?.[2] || "";
  const trade = stated || headlineTrade(headline);
  if (!trade) return undefined;
  if (trade.length <= TRADE_MAX_LENGTH) return trade;
  const cut = trade.slice(0, TRADE_MAX_LENGTH);
  // Stop at a whole word when there is one to stop at.
  return (cut.includes(" ") ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim();
}
