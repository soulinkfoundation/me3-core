import { describe, expect, it, vi } from "vitest";
import {
  DRIVE_MULTIPART_PART_BYTES,
  completeDriveMultipartUpload,
  createDriveMultipartUpload,
  deleteDriveFile,
  getDriveFileContentResponse,
  getDriveFileThumbnailResponse,
  updateDriveFile,
  uploadDriveMultipartPart,
} from "./files";
import type { Env } from "./types";

const readyFile = {
  id: "file-1",
  owner_id: "owner-1",
  folder_id: null,
  filename: "photo.png",
  mime_type: "image/png",
  size: 42,
  storage_key: "drive/owner-1/root/file-1/photo.png",
  etag: null,
  sha256: null,
  status: "ready" as const,
  preview_kind: "image" as const,
  extracted_text: null,
  metadata_json: null,
  created_at: "2026-07-21T12:00:00.000Z",
  updated_at: "2026-07-21T12:00:00.000Z",
};

function createEnv(options: {
  assistantStorageReference?: boolean;
  deleteObject?: () => Promise<void>;
  getObject?: (key: string, options?: unknown) => Promise<unknown>;
  putObject?: (key: string, value: unknown, options?: unknown) => Promise<unknown>;
} = {}) {
  const update = vi.fn(async () => ({ meta: { changes: 1 } }));
  const deleteObject = vi.fn(options.deleteObject || (async () => undefined));
  const getObject = vi.fn(options.getObject || (async () => null));
  const putObject = vi.fn(options.putObject || (async () => undefined));
  const db = {
    prepare(sql: string) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes("FROM assistant_attachments")) {
                return options.assistantStorageReference ? { id: "attachment-1" } : null;
              }
              if (sql.startsWith("SELECT id FROM drive_files")) return null;
              return sql.includes("SELECT") ? readyFile : null;
            },
            run: update,
          };
        },
      };
    },
  };

  return {
    env: {
      DB: db,
      SITE_ASSETS: { delete: deleteObject, get: getObject, put: putObject },
    } as unknown as Env,
    deleteObject,
    getObject,
    putObject,
    update,
  };
}

function createMultipartEnv() {
  let fileRow: Record<string, unknown> | null = null;
  let uploadRow: Record<string, unknown> | null = null;
  const parts = new Map<number, { part_number: number; etag: string; size: number }>();
  const uploadPart = vi.fn(async (partNumber: number) => ({
    partNumber,
    etag: `etag-${partNumber}`,
  }));
  const complete = vi.fn(async () => ({
    etag: "complete-etag",
    httpEtag: '"complete-etag"',
    size: DRIVE_MULTIPART_PART_BYTES + 3,
  }));
  const abort = vi.fn(async () => undefined);
  const head = vi.fn(async () => ({
    etag: "complete-etag",
    httpEtag: '"complete-etag"',
    size: DRIVE_MULTIPART_PART_BYTES + 3,
  }));
  const multipart = { uploadId: "r2-upload-1", uploadPart, complete, abort };
  const createMultipartUpload = vi.fn(async () => multipart);
  const resumeMultipartUpload = vi.fn(() => multipart);

  function statement(sql: string) {
    let values: unknown[] = [];
    return {
      bind(...nextValues: unknown[]) {
        values = nextValues;
        return this;
      },
      async first<T>() {
        if (sql.includes("SELECT upload.id")) return uploadRow as T | null;
        if (sql.includes("FROM drive_files") && sql.includes("status = 'ready'")) {
          if (sql.startsWith("SELECT id FROM drive_files")) return null as T | null;
          return fileRow?.status === "ready" ? fileRow as T : null;
        }
        return null as T | null;
      },
      async all<T>() {
        if (sql.includes("FROM drive_multipart_parts")) {
          return { results: [...parts.values()].sort((a, b) => a.part_number - b.part_number) as T[] };
        }
        return { results: [] as T[] };
      },
      async run() {
        if (sql.includes("INSERT INTO drive_files")) {
          fileRow = {
            id: values[0],
            owner_id: values[1],
            folder_id: values[2],
            filename: values[3],
            mime_type: values[4],
            size: values[5],
            storage_key: values[6],
            etag: null,
            sha256: null,
            status: "uploading",
            preview_kind: values[7],
            extracted_text: null,
            metadata_json: values[8],
            created_at: "2026-07-21T12:00:00.000Z",
            updated_at: "2026-07-21T12:00:00.000Z",
          };
        } else if (sql.includes("INSERT INTO drive_multipart_uploads")) {
          uploadRow = {
            id: values[0],
            file_id: values[1],
            owner_id: values[2],
            filename: fileRow?.filename,
            mime_type: fileRow?.mime_type,
            storage_key: values[3],
            r2_upload_id: values[4],
            part_size: values[5],
            total_size: values[6],
            status: "uploading",
            expires_at: values[7],
          };
        } else if (sql.includes("INSERT INTO drive_multipart_parts")) {
          parts.set(Number(values[1]), {
            part_number: Number(values[1]),
            etag: String(values[2]),
            size: Number(values[3]),
          });
        } else if (sql.includes("SET status = 'ready'")) {
          if (fileRow) {
            fileRow.status = "ready";
            fileRow.etag = values[0];
          }
        } else if (sql.includes("SET status = 'completed'")) {
          if (uploadRow) uploadRow.status = "completed";
        }
        return { meta: { changes: 1 } };
      },
    };
  }

  const db = {
    prepare: statement,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((item) => item.run()));
    },
  };
  return {
    env: {
      DB: db,
      SITE_ASSETS: { createMultipartUpload, resumeMultipartUpload, head },
    } as unknown as Env,
    createMultipartUpload,
    resumeMultipartUpload,
    uploadPart,
    complete,
    head,
  };
}

describe("deleteDriveFile", () => {
  it("removes the R2 object before trashing its database record", async () => {
    const { env, deleteObject, update } = createEnv();

    await expect(deleteDriveFile(env, "owner-1", "file-1")).resolves.toEqual({
      ok: true,
      fileId: "file-1",
    });

    expect(deleteObject).toHaveBeenCalledWith(readyFile.storage_key);
    expect(update).toHaveBeenCalledTimes(1);
    expect(deleteObject.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
  });

  it("does not trash the file when R2 deletion fails", async () => {
    const storageError = new Error("R2 unavailable");
    const { env, update } = createEnv({
      deleteObject: async () => {
        throw storageError;
      },
    });

    await expect(deleteDriveFile(env, "owner-1", "file-1")).rejects.toThrow(storageError);
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps an R2 object that is also referenced by an assistant attachment", async () => {
    const { env, deleteObject, update } = createEnv({
      assistantStorageReference: true,
    });

    await expect(deleteDriveFile(env, "owner-1", "file-1")).resolves.toEqual({
      ok: true,
      fileId: "file-1",
    });

    expect(deleteObject).not.toHaveBeenCalledWith(readyFile.storage_key);
    expect(deleteObject).toHaveBeenCalledWith("drive-thumbnails/owner-1/file-1.webp");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("updateDriveFile", () => {
  it("renames a shared assistant image without copying or deleting its R2 object", async () => {
    const { env, deleteObject, getObject, putObject } = createEnv({
      assistantStorageReference: true,
    });

    await expect(
      updateDriveFile(env, "owner-1", "file-1", { filename: "renamed.png" }),
    ).resolves.toMatchObject({ ok: true });

    expect(getObject).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });
});

describe("getDriveFileContentResponse", () => {
  it("serves a bounded byte range for native video preview", async () => {
    const bytes = new Uint8Array(10).fill(7);
    const { env, getObject } = createEnv({
      getObject: async () => ({
        body: bytes,
        size: bytes.byteLength,
        httpEtag: '"etag-1"',
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", "video/mp4");
        },
      }),
    });

    const response = await getDriveFileContentResponse(env, "owner-1", "file-1", {
      rangeHeader: "bytes=10-19",
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Range")).toBe("bytes 10-19/42");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(getObject).toHaveBeenCalledWith(readyFile.storage_key, {
      range: { offset: 10, length: 10 },
    });
  });

  it("rejects unsatisfiable byte ranges without reading R2", async () => {
    const { env, getObject } = createEnv();

    const response = await getDriveFileContentResponse(env, "owner-1", "file-1", {
      rangeHeader: "bytes=42-",
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */42");
    expect(getObject).not.toHaveBeenCalled();
  });
});

// Synthetic storage; the Images service is simulated.
describe("getDriveFileThumbnailResponse", () => {
  const thumbnailKey = "drive-thumbnails/owner-1/file-1.webp";
  const original = () => ({ body: new Uint8Array(42), size: 42, httpEtag: '"etag-1"', writeHttpMetadata() {} });
  function images(response: Response) {
    const output = vi.fn(async () => ({ response: () => response }));
    const transform = vi.fn(() => ({ output }));
    return { binding: { input: vi.fn(() => ({ transform })) }, transform, output };
  }

  it("resizes the original once, stores the result and serves it for long-term caching", async () => {
    const { env, getObject, putObject } = createEnv({
      getObject: async (key) => (key === thumbnailKey ? null : original()),
    });
    const { binding, transform } = images(new Response(new Uint8Array(7)));
    env.IMAGES = binding as unknown as Env["IMAGES"];

    const response = await getDriveFileThumbnailResponse(env, "owner-1", "file-1");

    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect((await response.arrayBuffer()).byteLength).toBe(7);
    expect(transform).toHaveBeenCalledWith({ width: 480, fit: "scale-down" });
    expect(getObject).toHaveBeenCalledWith(readyFile.storage_key);
    expect(putObject).toHaveBeenCalledWith(thumbnailKey, expect.any(ArrayBuffer), {
      httpMetadata: { contentType: "image/webp" },
    });
  });

  it("serves a stored thumbnail without reading the original or resizing again", async () => {
    const { env, getObject, putObject } = createEnv({
      getObject: async () => ({ body: new Uint8Array(7), size: 7 }),
    });
    const { binding } = images(new Response(new Uint8Array(7)));
    env.IMAGES = binding as unknown as Env["IMAGES"];

    const response = await getDriveFileThumbnailResponse(env, "owner-1", "file-1");

    expect(response.headers.get("Content-Length")).toBe("7");
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getObject).toHaveBeenCalledWith(thumbnailKey);
    expect(binding.input).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("falls back to the original when the image cannot be resized", async () => {
    const { env, putObject } = createEnv({
      getObject: async (key) => (key === thumbnailKey ? null : original()),
    });
    env.IMAGES = images(new Response(null, { status: 415 })).binding as unknown as Env["IMAGES"];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await getDriveFileThumbnailResponse(env, "owner-1", "file-1");

    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(response.headers.get("Content-Length")).toBe("42");
    expect(putObject).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("serves the original when the install has no Images service", async () => {
    const { env } = createEnv({
      getObject: async (key) => (key === thumbnailKey ? null : original()),
    });

    const response = await getDriveFileThumbnailResponse(env, "owner-1", "file-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("42");
  });
});

describe("Drive multipart uploads", () => {
  it("streams validated parts into R2 and completes the Files record", async () => {
    const { env, createMultipartUpload, resumeMultipartUpload, uploadPart, complete } =
      createMultipartEnv();
    const totalSize = DRIVE_MULTIPART_PART_BYTES + 3;
    const created = await createDriveMultipartUpload(env, "owner-1", {
      filename: "short.mp4",
      mimeType: "video/mp4",
      size: totalSize,
    });

    expect(created.upload).toMatchObject({
      filename: "short.mp4",
      mimeType: "video/mp4",
      partSize: DRIVE_MULTIPART_PART_BYTES,
      totalSize,
      status: "uploading",
    });
    expect(createMultipartUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^drive\/owner-1\/.*-short\.mp4$/),
      expect.objectContaining({ httpMetadata: { contentType: "video/mp4" } }),
    );

    await uploadDriveMultipartPart(
      env,
      "owner-1",
      created.upload.id,
      "1",
      new Blob([new Uint8Array([1])]).stream(),
      {
        contentLength: String(DRIVE_MULTIPART_PART_BYTES),
        contentRange: `bytes 0-${DRIVE_MULTIPART_PART_BYTES - 1}/${totalSize}`,
      },
    );
    await uploadDriveMultipartPart(
      env,
      "owner-1",
      created.upload.id,
      "2",
      new Blob([new Uint8Array([2])]).stream(),
      {
        contentLength: "3",
        contentRange: `bytes ${DRIVE_MULTIPART_PART_BYTES}-${totalSize - 1}/${totalSize}`,
      },
    );
    const result = await completeDriveMultipartUpload(env, "owner-1", created.upload.id);

    expect(uploadPart).toHaveBeenCalledTimes(2);
    expect(resumeMultipartUpload).toHaveBeenCalledTimes(3);
    expect(complete).toHaveBeenCalledWith([
      { partNumber: 1, etag: "etag-1" },
      { partNumber: 2, etag: "etag-2" },
    ]);
    expect(result.file).toMatchObject({
      filename: "short.mp4",
      size: totalSize,
      status: "ready",
      etag: '"complete-etag"',
    });

    await expect(
      completeDriveMultipartUpload(env, "owner-1", created.upload.id),
    ).resolves.toMatchObject({ file: { id: created.upload.fileId, status: "ready" } });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("recovers when R2 completed but the first database finalization response was lost", async () => {
    const { env, complete, head } = createMultipartEnv();
    const totalSize = DRIVE_MULTIPART_PART_BYTES + 3;
    const created = await createDriveMultipartUpload(env, "owner-1", {
      filename: "short.mp4",
      mimeType: "video/mp4",
      size: totalSize,
    });
    await uploadDriveMultipartPart(
      env,
      "owner-1",
      created.upload.id,
      "1",
      new Blob([new Uint8Array([1])]).stream(),
      {
        contentLength: String(DRIVE_MULTIPART_PART_BYTES),
        contentRange: `bytes 0-${DRIVE_MULTIPART_PART_BYTES - 1}/${totalSize}`,
      },
    );
    await uploadDriveMultipartPart(
      env,
      "owner-1",
      created.upload.id,
      "2",
      new Blob([new Uint8Array([2])]).stream(),
      {
        contentLength: "3",
        contentRange: `bytes ${DRIVE_MULTIPART_PART_BYTES}-${totalSize - 1}/${totalSize}`,
      },
    );
    complete.mockRejectedValueOnce(new Error("R2 upload no longer exists"));

    await expect(
      completeDriveMultipartUpload(env, "owner-1", created.upload.id),
    ).resolves.toMatchObject({ file: { status: "ready", size: totalSize } });
    expect(head).toHaveBeenCalledOnce();
  });

  it("rejects a part whose range does not match its slot", async () => {
    const { env, uploadPart } = createMultipartEnv();
    const totalSize = DRIVE_MULTIPART_PART_BYTES + 3;
    const created = await createDriveMultipartUpload(env, "owner-1", {
      filename: "short.mp4",
      mimeType: "video/mp4",
      size: totalSize,
    });

    await expect(uploadDriveMultipartPart(
      env,
      "owner-1",
      created.upload.id,
      "1",
      new Blob([new Uint8Array([1])]).stream(),
      {
        contentLength: String(DRIVE_MULTIPART_PART_BYTES),
        contentRange: `bytes 1-${DRIVE_MULTIPART_PART_BYTES}/${totalSize}`,
      },
    )).rejects.toThrow("Content-Range must be");
    expect(uploadPart).not.toHaveBeenCalled();
  });
});
