import { z } from "zod";

/**
 * Every environment variable the app reads, validated once at boot. Anything not listed here
 * does not exist as far as the code is concerned. See docs/engineering-standards.md section 8.
 */
const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  /** Base64, 32 bytes. Master key for envelope encryption of channel credentials. */
  CREDENTIALS_MASTER_KEY: z.string().min(40),
  CREDENTIALS_MASTER_KEY_ID: z.string().default("k1"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  EBAY_CLIENT_ID: z.string().optional(),
  EBAY_CLIENT_SECRET: z.string().optional(),
  EBAY_RUNAME: z.string().optional(),
  EBAY_DEV_ID: z.string().optional(),
  EBAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_DELETION_VERIFICATION_TOKEN: z.string().min(32).max(80).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Direct Postgres connection for the job tier and integration tests. Use the pooler URL on Vercel. */
  DATABASE_URL: z.string().url(),
  /** 32 random bytes, base64. Signs OAuth state parameters. */
  OAUTH_STATE_SECRET: z.string().min(40),
  LOG_LEVEL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  // A blank line in .env counts as unset, not as an empty string.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  const parsed = serverSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
