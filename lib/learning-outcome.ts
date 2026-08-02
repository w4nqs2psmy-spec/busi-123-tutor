/**
 * Splitting the compound learning-outcome string ("LO2/LO3").
 *
 * This lives on its own, away from `topics.ts`, for one specific reason:
 * `topics.ts` reads `topics.json` with `node:fs`, so anything that imports a
 * *value* from it gets pulled into that dependency. The browse view model is
 * shared with client components, so it must reach this helper without dragging
 * `node:fs` into the browser bundle.
 *
 * One implementation, used by both `topics.ts` and `browse-model.ts`.
 */
export function splitLearningOutcomes(value: string): string[] {
  return value
    .split('/')
    .map((lo) => lo.trim())
    .filter(Boolean);
}
