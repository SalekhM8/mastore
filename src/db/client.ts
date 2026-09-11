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
    client = postgres(env().DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // pooler-safe (Supavisor transaction mode)
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
