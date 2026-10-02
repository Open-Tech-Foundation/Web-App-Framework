export function reactive<T extends object>(initial: T): T;
export function reactive(): Record<string, unknown>;
export function isReactive(value: unknown): boolean;
export function toRawValue<T>(value: T): T;
export function snapshot<T>(value: T): T;
