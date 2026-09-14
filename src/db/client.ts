import postgres from "postgres";
import { env } from "@/lib/env";

/**
 * Service connection for the job tier. Bypasses RLS by design, so every query in src/db
 * filters by workspace_id or by a primary key that was itself loaded with a workspace filter.
 * Never import this from a client component or from anything that renders for a browser.
 */

let client: postgres.Sql | undefined;

export function db(): postgres.Sql {
  if (!client) {
    const url = env().DATABASE_URL;
    const local = /127\.0\.0\.1|localhost/.test(url);
    client = postgres(url, {
      // Supabase's transaction pooler on Vercel: one connection per function instance, SSL on,
      // no prepared statements. Locally, a small pool against Docker.
      max: local ? 5 : 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ...(local ? {} : { ssl: "require" as const }),
      onnotice: () => {},
    });
  }
  return client;
}

export type Sql = postgres.Sql | postgres.TransactionSql;

/**
 * postgres.js types sql.json() as a closed JSONValue union that rejects our record and
 * interface types; JSON.stringify accepts every value we pass. One cast, here, documented.
 */
export function json(sql: Sql, value: unknown): ReturnType<postgres.Sql["json"]> {
  return sql.json(value as never);
}
