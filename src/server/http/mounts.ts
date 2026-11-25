import type { IncomingMessage, ServerResponse } from "node:http";
import { oidcMount } from "../oidc";

export interface Mount {
  prefix: string;
  handle: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
}

/** Non-Next handlers on the custom server: the OpenID Connect provider and its discovery document. */
export async function mounts(): Promise<Mount[]> {
  return [
    { prefix: "/oidc", handle: oidcMount },
    { prefix: "/.well-known/openid-configuration", handle: oidcMount },
  ];
}
