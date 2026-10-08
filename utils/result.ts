export type Result<T> = { data: T; error: null } | { data: null; error: Error };
export function ok<T>(data: T): Result<T> { return { data, error: null }; }
export function fail(error: Error): Result<never> { return { data: null, error }; }
