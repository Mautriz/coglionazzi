import { ORPCError } from "@orpc/server";
import { assertFileAccess } from "./fileAccess";
import { fileServeHeaders, fileService } from "./files";
import { resolveHttpCaller } from "./httpCaller";

/** Serve an uploaded file by its storage id.
 *
 *  Reading an upload requires a caller (session cookie or API key) AND
 *  authorization for that specific file — see `assertFileAccess`. The
 *  recorded metadata (never the id's extension) decides the content type and
 *  download name, and `fileServeHeaders` keeps anything scriptable from
 *  running on our origin.
 *
 *  Lives here rather than in the route so it can be tested directly. */
export async function serveFile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const fileId = url.searchParams.get("fileId");

  if (!fileId) {
    return new Response("Missing fileId query parameter", { status: 400 });
  }

  const caller = await resolveHttpCaller(request);
  if (!caller) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Bearer realm="insacco"' },
    });
  }

  let file;
  try {
    file = await assertFileAccess(caller.userId, fileId);
  } catch (error) {
    // assertFileAccess answers NOT_FOUND for both "no such id" and "not
    // yours" — the id is the only secret, so we never confirm one exists.
    if (error instanceof ORPCError) {
      return new Response("File not found", { status: 404 });
    }
    throw error;
  }

  if (!(await fileService.exists(file.path))) {
    return new Response("File not found", { status: 404 });
  }

  return new Response(fileService.getFileStream(file.path), {
    status: 200,
    headers: {
      ...fileServeHeaders({
        name: file.metadata.name ?? file.path,
        type: file.metadata.type ?? "",
      }),
      // `private`: responses are now per-user authorized, so no shared cache
      // may hold them.
      "Cache-Control": "private, max-age=86400",
    },
  });
}
