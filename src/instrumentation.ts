/**
 * Next.js bundles route handlers and server actions in their own module graph, separate from server.ts
 * (which runs the OIDC provider and the jobs). Each graph must connect the module hooks (billing to
 * entitlements and hosting, seat checks, launcher). Found in staging UAT: without this, payments made
 * through the web pages did not update entitlements or create instances.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { wire } = await import("./server/wire");
    wire();
  }
}
