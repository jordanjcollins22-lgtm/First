import type { Instrumentation } from "next";

import { log } from "@/lib/log";

/**
 * Every server error, written down once, with where it happened.
 *
 * A page that threw, a route handler that threw, a server action that
 * threw: each lands here with the path, the method and which kind of
 * thing was running. Until now an error inside a server action reached
 * the log only if the action's own catch block chose to print it, and most
 * chose to return a message to the screen instead. That message is gone
 * the moment the person navigates away; this line is not.
 *
 * Headers are not written. They carry the session cookie.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  log.error("request.failed", err, {
    path: request.path,
    method: request.method,
    router: context.routerKind,
    route: context.routePath,
    kind: context.routeType,
    renderSource: context.renderSource,
  });
};
