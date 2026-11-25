import { shared } from "../shared";
/** Per-app launcher status (subscription state, upgrade calls to action). Filled by billing and entitlements (Phases 2 and 3). */
export type LauncherState = { label?: string; open?: boolean; url?: string; cta?: { label: string; href: string } };
type Fn = (organizationId: string) => Promise<Record<string, LauncherState>>;
const box = shared("launcherExtras", () => ({ fn: (async () => ({})) as Fn }));
export function setLauncherExtras(f: Fn) {
  box.fn = f;
}
export function launcherExtras(organizationId: string) {
  return box.fn(organizationId);
}
