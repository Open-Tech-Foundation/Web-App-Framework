export interface Resource<T> {
  readonly data: T | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  refetch(): Promise<T | undefined> | undefined;
}
export function resource<T>(fetcher: (value: true, context: { signal: AbortSignal | undefined }) => T | Promise<T>, options?: { initial?: T }): Resource<T>;
export function resource<S, T>(source: () => S, fetcher: (value: NonNullable<Exclude<S, false>>, context: { signal: AbortSignal | undefined }) => T | Promise<T>, options?: { initial?: T }): Resource<T>;
export function __setResourceServer(value: boolean | null): void;
