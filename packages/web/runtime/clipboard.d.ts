export function copyText(text: any): void;
/**
 * Copy `text`, then give `button` the standard "Copied" feedback: add `is-copied`,
 * swap its `.otfw-copy-label` to "Copied", and revert after 2s. Idempotent across
 * rapid clicks (the pending revert is reset each time).
 */
export function copyWithFeedback(button: any, text: any): void;
