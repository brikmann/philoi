/**
 * `e instanceof Error` is too narrow for Supabase failures: when the underlying
 * fetch() itself fails (network drop, DNS, tunnel hiccup — not a Postgres/PostgREST
 * error), @supabase/postgrest-js returns a plain `{ message, details, hint, code }`
 * object, not an Error instance. Checking for a `.message` string covers both shapes.
 */
export function getErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return fallback;
}
