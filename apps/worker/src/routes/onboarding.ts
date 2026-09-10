import type { AppHono, OwnerRouteDeps } from "../http/types";
import type { Env } from "../types";

export type OnboardingStartStep = 2 | 3;

export async function getPendingOnboardingStartStep(
  env: Env,
  ownerId: string,
): Promise<OnboardingStartStep | null> {
  const row = await env.DB.prepare(
    `SELECT current_step
     FROM owner_onboarding
     WHERE user_id = ?
       AND completed_at IS NULL
       AND current_step IN (2, 3)
       AND EXISTS (
         SELECT 1 FROM sites
         WHERE sites.id = owner_onboarding.profile_site_id
           AND sites.user_id = owner_onboarding.user_id
           AND sites.site_role = 'profile'
       )`,
  )
    .bind(ownerId)
    .first<{ current_step: number }>();
  return row?.current_step === 2 || row?.current_step === 3
    ? row.current_step
    : null;
}

export function registerOnboardingRoutes(app: AppHono, deps: OwnerRouteDeps): void {
  app.post("/api/onboarding/progress", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<{ step?: unknown }>().catch(() => null);
    if (!body || (body.step !== 2 && body.step !== 3)) {
      return c.json({ error: "Onboarding step must be 2 or 3" }, 400);
    }

    const currentStep = await getPendingOnboardingStartStep(c.env, ownerId);
    if (!currentStep) return c.json({ error: "Onboarding is not pending" }, 404);
    const nextStep = Math.max(currentStep, body.step) as OnboardingStartStep;
    await c.env.DB.prepare(
      `UPDATE owner_onboarding
       SET current_step = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND completed_at IS NULL`,
    )
      .bind(nextStep, ownerId)
      .run();
    return c.json({ ok: true, currentStep: nextStep });
  });

  app.post("/api/onboarding/complete", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const currentStep = await getPendingOnboardingStartStep(c.env, ownerId);
    if (!currentStep) return c.json({ error: "Onboarding is not pending" }, 404);
    await c.env.DB.prepare(
      `UPDATE owner_onboarding
       SET completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND completed_at IS NULL`,
    )
      .bind(ownerId)
      .run();
    return c.json({ ok: true });
  });
}
