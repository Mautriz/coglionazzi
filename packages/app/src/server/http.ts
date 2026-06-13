import { ORPCError } from "@orpc/server";

/** Permissive CORS for the public support widget endpoints. The widget runs on
 *  arbitrary third-party origins; these endpoints are gated by the widget key /
 *  ticket token, carry no cookies, and expose only public support data. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

/** A JSON response with CORS headers applied. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/** Standard CORS preflight reply. */
export function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const STATUS_BY_CODE: Record<string, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

/** Map a thrown error to a CORS'd JSON error response. ORPCError codes map to
 *  their HTTP status; anything else is a 500. */
export function errorResponse(err: unknown): Response {
  if (err instanceof ORPCError) {
    return jsonResponse(
      { error: err.message },
      STATUS_BY_CODE[err.code] ?? 500,
    );
  }
  return jsonResponse({ error: "Something went wrong." }, 500);
}
