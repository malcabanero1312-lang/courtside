export interface DbError {
  code?: string;
  message?: string;
  hint?: string | null;
  details?: string | null;
}

export function friendlyError(error: DbError | null | undefined, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  const code = error.code ?? "";
  if (code === "23P01") {
    return "That time overlaps another booking for this coach or court. Pick one of the suggested times or another court.";
  }
  if (code === "P0001" || code === "P0002") {
    return error.message || fallback;
  }
  if (code === "42501") {
    return error.message && !error.message.includes("row-level security")
      ? error.message
      : "You don't have permission to do that. Ask an admin if you need access.";
  }
  if (code === "23505") {
    return "This already exists. Check for a duplicate and try again.";
  }
  if (code === "23503") {
    return "This is still used by existing appointments. Mark it as inactive instead of deleting it.";
  }
  if (code === "23514") {
    return "Some of the information isn't in the expected format. Please check the fields and try again.";
  }
  if (code === "PGRST116") {
    return "We couldn't find that record. It may have been removed.";
  }
  logError("database", error);
  return fallback;
}

export function logError(scope: string, error: unknown): void {
  const value = error as DbError & { name?: string };
  console.error(`[courtside:${scope}]`, {
    code: value?.code,
    name: value?.name,
    message: typeof value?.message === "string" ? value.message.slice(0, 300) : String(error).slice(0, 300)
  });
}
