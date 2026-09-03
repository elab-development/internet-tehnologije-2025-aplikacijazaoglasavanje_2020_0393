/**
 * Values C2C-QA-3's global setup publishes to every test worker.
 *
 * They exist so AC8 is checkable: a file that started its own container would see a
 * different URL and a different postmaster start time from the ones recorded here.
 */
declare module "vitest" {
  export interface ProvidedContext {
    /** Connection string for the one database this run uses. */
    testDatabaseUrl: string;
    /** `pg_postmaster_start_time()` as an ISO string, read once at setup. */
    postmasterStartTime: string;
  }
}

export {};
