import {
  DriveInputError,
  abortDriveMultipartUpload,
  completeDriveMultipartUpload,
  createDriveMultipartUpload,
  createDriveFolder,
  deleteDriveFile,
  deleteDriveFolder,
  getDriveFileContentResponse,
  getDriveFileThumbnailResponse,
  getDriveFilePreview,
  getDriveMultipartUpload,
  getDriveStatus,
  isMissingDriveTablesError,
  listDriveFolders,
  listDriveItems,
  updateDriveFile,
  updateDriveFolder,
  uploadDriveMultipartPart,
  uploadDriveFiles,
} from "../files";
import { privateConditionalJson } from "../http/conditional-json";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

export function registerFilesRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/files/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    return privateConditionalJson(c, getDriveStatus(c.env));
  });

  app.get("/api/files/folders", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return privateConditionalJson(c, await listDriveFolders(c.env, ownerId));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.post("/api/files/folders", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await createDriveFolder(c.env, ownerId, await c.req.json().catch(() => null)),
        201,
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.put("/api/files/folders/:folderId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await updateDriveFolder(
          c.env,
          ownerId,
          c.req.param("folderId"),
          await c.req.json().catch(() => null),
        ),
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.delete("/api/files/folders/:folderId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(await deleteDriveFolder(c.env, ownerId, c.req.param("folderId")));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.get("/api/files/items", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return privateConditionalJson(
        c,
        await listDriveItems(c.env, ownerId, {
          folderId: c.req.query("folderId"),
          q: c.req.query("q"),
        }),
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.post("/api/files/upload", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      const form = await c.req.formData().catch(() => null);
      if (!form) throw new DriveInputError("Upload form data is invalid.");
      return c.json(await uploadDriveFiles(c.env, ownerId, form), 201);
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.post("/api/files/multipart", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await createDriveMultipartUpload(c.env, ownerId, await c.req.json().catch(() => null)),
        201,
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.get("/api/files/multipart/:uploadId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(await getDriveMultipartUpload(c.env, ownerId, c.req.param("uploadId")));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.put("/api/files/multipart/:uploadId/parts/:partNumber", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      const body = c.req.raw.body;
      if (!body) throw new DriveInputError("Upload part body is required.");
      return c.json(
        await uploadDriveMultipartPart(
          c.env,
          ownerId,
          c.req.param("uploadId"),
          c.req.param("partNumber"),
          body,
          {
            contentLength: c.req.header("X-Upload-Part-Size") || c.req.header("Content-Length"),
            contentRange: c.req.header("Content-Range"),
          },
        ),
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.post("/api/files/multipart/:uploadId/complete", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await completeDriveMultipartUpload(c.env, ownerId, c.req.param("uploadId")),
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.delete("/api/files/multipart/:uploadId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(await abortDriveMultipartUpload(c.env, ownerId, c.req.param("uploadId")));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.get("/api/files/:fileId/content", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return await getDriveFileContentResponse(c.env, ownerId, c.req.param("fileId"), {
        download: c.req.query("download") === "1",
        rangeHeader: c.req.header("Range"),
      });
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.get("/api/files/:fileId/thumbnail", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return await getDriveFileThumbnailResponse(c.env, ownerId, c.req.param("fileId"));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.get("/api/files/:fileId/preview", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(await getDriveFilePreview(c.env, ownerId, c.req.param("fileId")));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.put("/api/files/:fileId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(
        await updateDriveFile(
          c.env,
          ownerId,
          c.req.param("fileId"),
          await c.req.json().catch(() => null),
        ),
      );
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });

  app.delete("/api/files/:fileId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      return c.json(await deleteDriveFile(c.env, ownerId, c.req.param("fileId")));
    } catch (error) {
      return filesErrorResponse(c, error);
    }
  });
}

function filesErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof DriveInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  if (isMissingDriveTablesError(error)) {
    return c.json(
      {
        ok: false,
        error:
          "Files storage is not migrated yet. Restart the local Worker or run pnpm --filter @me3-core/worker db:migrate:local.",
      },
      503,
    );
  }
  throw error;
}
