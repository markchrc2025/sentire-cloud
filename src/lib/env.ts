import { z } from "zod";

// Server environment. Read once, validated. Secrets never logged.
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  OIDC_ISSUER: z.string().url().optional(),
  DATABASE_URL: z.string().min(1).default("postgres://postgres@localhost:5432/sentire_cloud_dev"),
  SESSION_SECRET: z.string().min(32).default("dev-session-secret-dev-session-secret"),
  KEY_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i).default("0".repeat(64)),
  PAYMENT_PROVIDER: z.enum(["test", "paymongo", "maya"]).default("test"),
  POSTAL_URL: z.string().optional(),
  POSTAL_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Sentire Cloud <no-reply@sentire.solutions>"),
  CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(15).default(60),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function env(): Env {
  if (!cached) {
    const parsed = schema.parse(process.env);
    if (parsed.NODE_ENV === "production") {
      if (parsed.SESSION_SECRET.startsWith("dev-")) throw new Error("SESSION_SECRET must be set in production");
      if (/^0+$/.test(parsed.KEY_ENCRYPTION_KEY)) throw new Error("KEY_ENCRYPTION_KEY must be set in production");
    }
    cached = parsed;
  }
  return cached;
}

export function issuer(): string {
  const e = env();
  return (e.OIDC_ISSUER ?? e.APP_URL).replace(/\/$/, "");
}
