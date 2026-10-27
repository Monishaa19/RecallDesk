export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg, "bad_request");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");

/** Wrap a Supabase/PostgREST error without leaking user content into logs. */
export function dbError(err: { message?: string; code?: string } | null, what: string): HttpError {
  console.error(`[db] ${what} failed: ${err?.code ?? ""} ${err?.message ?? "unknown error"}`);
  return new HttpError(502, `We couldn't reach your saved thoughts right now (${what}). Please try again.`, "db_error");
}
