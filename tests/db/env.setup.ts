import { randomBytes } from "node:crypto";

/**
 * Environment for integration tests. Always the local Docker Supabase, never the hosted project,
 * even when .env.local points at it. Secrets are throwaway.
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.test.local")) {
  for (const line of readFileSync(".env.test.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m?.[1] && m[2] !== undefined) process.env[m[1]] = m[2];
  }
}
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
process.env.CREDENTIALS_MASTER_KEY ??= randomBytes(32).toString("base64");
process.env.CREDENTIALS_MASTER_KEY_ID ??= "k1";
process.env.OAUTH_STATE_SECRET ??= randomBytes(32).toString("base64");
process.env.APP_URL ??= "http://localhost:3000";
process.env.INNGEST_DEV ??= "1";
