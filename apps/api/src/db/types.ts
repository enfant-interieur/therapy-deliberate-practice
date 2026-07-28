import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./schema";

/**
 * Application queries use the asynchronous D1 contract as their canonical type.
 * The local better-sqlite3 adapter has the same Drizzle query surface and its
 * synchronous results are safely awaitable by the application.
 */
export type ApiDatabase = DrizzleD1Database<typeof schema>;
