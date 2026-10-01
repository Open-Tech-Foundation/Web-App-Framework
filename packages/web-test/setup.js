// esdev creates the DOM realm and compiles JSX through the project's plugins.
// Per-file setup registers teardown without replacing any DOM globals.
import { afterEach } from "runtime:test";
import { cleanup } from "./index.js";

if (typeof document === "undefined") {
  throw new Error("@opentf/web-test/setup requires esdev test --dom (or --browser)");
}

afterEach(cleanup);
