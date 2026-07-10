import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { resolveMemberByName } from "./helpers";

export const userDetailsArgs = z.object({
  name: z.string().min(1).max(60),
}).strict();

type Args = z.infer<typeof userDetailsArgs>;

/**
 * Look up one team member by name. When the name is ambiguous the tool
 * returns the candidate list WITHOUT details — the model is instructed to
 * ask the manager which person they meant.
 */
export async function getUserDetails(ctx: ToolContext, args: Args) {
  const { match, candidates } = await resolveMemberByName(ctx, args.name);

  if (!match) {
    return {
      found: false,
      ambiguous: candidates.length > 1,
      candidates: candidates.map((c) => ({ name: c.name, role: c.role, region: c.region })),
    };
  }

  const src = makeSource("user", match.id, match.name);
  return {
    found: true,
    member: {
      name:   match.name,
      role:   match.role,
      region: match.region ?? undefined,
      status: match.status,
      last_activity: match.last_activity_at,
      last_sync:     match.last_mobile_sync,
    },
    __sources: src ? [src] : [],
  };
}
