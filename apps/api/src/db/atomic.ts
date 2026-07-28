import type { ApiDatabase } from "./types";

type AtomicStatement = {
  run?: () => unknown;
};

type AtomicCapableDatabase = {
  batch?: (statements: readonly unknown[]) => Promise<unknown>;
  transaction?: (callback: (tx: unknown) => void) => unknown;
};

/**
 * Executes a fixed group of mutations in one database transaction.
 *
 * Cloudflare D1 exposes transactional `batch`, while the local better-sqlite3
 * adapter exposes synchronous `transaction`. Keeping the compatibility branch
 * here prevents route code from silently falling back to sequential writes.
 */
export const runAtomicMutation = async (
  db: ApiDatabase,
  buildStatements: (executor: ApiDatabase) => AtomicStatement[],
) => {
  const atomicDb = db as unknown as AtomicCapableDatabase;
  if (typeof atomicDb.batch === "function") {
    await atomicDb.batch(buildStatements(db));
    return;
  }
  if (typeof atomicDb.transaction === "function") {
    atomicDb.transaction((tx) => {
      for (const statement of buildStatements(tx as ApiDatabase)) {
        if (typeof statement.run !== "function") {
          throw new Error("The local atomic statement cannot be executed.");
        }
        statement.run();
      }
    });
    return;
  }
  throw new Error("The configured database does not support atomic mutations.");
};
