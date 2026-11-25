import { monotonicFactory } from "ulid";

const next = monotonicFactory();
/** All primary keys are ULIDs (sortable, 26 characters). */
export function newId(): string {
  return next();
}
