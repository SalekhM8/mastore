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
  EBAY_ENV: z.enum(["sandbox", "production"]).default("sandbox"),
  EBAY_DELETION_VERIFICATION_TOKEN: z.string().min(32).max(80).optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment:\n  ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
