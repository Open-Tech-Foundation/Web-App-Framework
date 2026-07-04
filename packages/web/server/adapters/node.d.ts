// Type definitions for the Node.js adapter (SPEC §11.4).
import type { IncomingMessage, ServerResponse } from "node:http";

import type { RequestHandler } from "../api.js";

export interface NodeAdapterOptions {
  /** Response for requests that match no API route (default: a 404). */
  fallback?: (request: Request) => Response | Promise<Response>;
}

/** Build a WHATWG `Request` from a Node `IncomingMessage`. */
export function toWebRequest(req: IncomingMessage, options?: { protocol?: string }): Promise<Request>;

/** Write a WHATWG `Response` to a Node `ServerResponse`. */
export function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void>;

/**
 * Turn a Fetch handler into a Node `(req, res)` listener:
 *
 *   import { createServer } from "node:http";
 *   import { apiHandler } from "./dist/server/api.js";
 *   import { toNodeListener } from "@opentf/web/server/adapters/node";
 *   createServer(toNodeListener(apiHandler)).listen(3000);
 */
export function toNodeListener(
  handler: RequestHandler,
  options?: NodeAdapterOptions,
): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
