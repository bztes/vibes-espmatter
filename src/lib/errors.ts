/** The message of a failed remote function call (an `error()` body) or any other error. */
export function errorMessage(err: unknown): string {
	return (
		(err as { body?: { message?: string } })?.body?.message ??
		(err instanceof Error ? err.message : String(err))
	);
}
