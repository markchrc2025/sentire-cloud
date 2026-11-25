import type { IncomingMessage, ServerResponse } from "node:http";

export interface Mount {
  prefix: string;
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** Non-Next handlers mounted on the custom server (the OIDC provider joins in Phase 1). */
export async function mounts(): Promise<Mount[]> {
  return [];
}
