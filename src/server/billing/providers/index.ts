import { env } from "@/lib/env";
import { mayaProvider } from "./maya";
import { paymongoProvider } from "./paymongo";
import { testProvider } from "./test";
import type { PaymentProvider } from "./types";

const all: Record<string, PaymentProvider> = { test: testProvider, paymongo: paymongoProvider, maya: mayaProvider };

export function provider(name?: string): PaymentProvider {
  const p = all[name ?? env().PAYMENT_PROVIDER];
  if (!p) throw new Error(`unknown payment provider ${name}`);
  if (p.name === "test" && process.env.NODE_ENV === "production" && process.env.SENTIRE_ENV !== "staging") throw new Error("test payments are off in production");
  return p;
}
