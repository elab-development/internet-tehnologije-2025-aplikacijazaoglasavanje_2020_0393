/**
 * The unique index behind `users.email`.
 *
 * Named here rather than inline at the call site so the string the route matches on and
 * the string the migration creates cannot drift apart silently -- a mismatch makes the
 * 409 branch dead code and the 500 comes back, with every happy-path test still green.
 */
export const USERS_EMAIL_LOWER_INDEX = "users_email_lower_idx";
