import { otfwcPath } from "@opentf/web-compiler";

process.env.OTFWC_BIN ??= otfwcPath();
await import("@opentf/web-test/setup");