import type { Env } from "./types";

export type DrivePreviewKind =
  | "image"
  | "pdf"
  | "text"
  | "markdown"
  | "csv"
  | "spreadsheet"
  | "download";

export type DriveFolder = {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  path: string;
  status: "active" | "trashed";
  createdAt: string;
  updatedAt: string;
};

export type DriveFile = {
  id: string;
  ownerId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  etag: string | null;
  sha256: string | null;
  status: "uploading" | "ready" | "trashed" | "failed";
  previewKind: DrivePreviewKind;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type DriveItems = {
  ok: true;
  folderId: string | null;
  q: string;
  folders: DriveFolder[];
  files: DriveFile[];
};

export type DriveMultipartUpload = {
  id: string;
  fileId: string;
  filename: string;
  mimeType: string;
  partSize: number;
  totalSize: number;
  status: "uploading" | "completed" | "aborted" | "failed";
  expiresAt: string;
  uploadedParts: Array<{ partNumber: number; etag: string; size: number }>;
};

export type DrivePreview =
  | {
      ok: true;
      file: DriveFile;
      previewKind: "image" | "pdf" | "download" | "spreadsheet";
      truncated: false;
    }
  | {
      ok: true;
      file: DriveFile;
      previewKind: "text" | "markdown" | "csv";
      text: string;
      truncated: boolean;
    };

export class DriveInputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DriveInputError";
  }
}

type DriveFolderRow = {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  status: "active" | "trashed";
  created_at: string;
  updated_at: string;
};

type DriveFileRow = {
  id: string;
  owner_id: string;
  folder_id: string | null;
  filename: string;
  mime_type: string;
  size: number | string;
  storage_key: string;
  etag: string | null;
  sha256: string | null;
  status: "uploading" | "ready" | "trashed" | "failed";
  preview_kind: DrivePreviewKind;
  extracted_text: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type DriveMultipartUploadRow = {
  id: string;
  file_id: string;
  owner_id: string;
  filename: string;
  mime_type: string;
  storage_key: string;
  r2_upload_id: string;
  part_size: number | string;
  total_size: number | string;
  status: DriveMultipartUpload["status"];
  expires_at: string;
};

type DriveMultipartPartRow = {
  part_number: number | string;
  etag: string;
  size: number | string;
};

const MAX_DRIVE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const DRIVE_MULTIPART_PART_BYTES = 10 * 1024 * 1024;
export const MAX_DRIVE_MULTIPART_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const DRIVE_MULTIPART_EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_PREVIEW_BYTES = 512 * 1024;
const MAX_EXTRACTED_TEXT_CHARS = 80_000;
const MAX_NAME_LENGTH = 160;
const ROOT_FOLDER_ID: string | null = null;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".json",
  ".xml",
  ".log",
  ".html",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".vue",
  ".yml",
  ".yaml",
]);

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown"]);
const CSV_EXTENSIONS = new Set([".csv", ".tsv"]);
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx", ".ods"]);

const SPREADSHEET_MIME_TYPES = new Set([
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.spreadsheet",
]);

export function getDriveStatus(env: Env) {
  return {
    ok: true,
    r2Available: Boolean(env.SITE_ASSETS),
    binding: "SITE_ASSETS" as const,
  };
}

export async function listDriveFolders(
  env: Env,
  ownerId: string,
): Promise<{ ok: true; folders: DriveFolder[] }> {
  const result = await env.DB.prepare(
    `SELECT id, owner_id, parent_id, name, path, status, created_at, updated_at
     FROM drive_folders
     WHERE owner_id = ? AND status = 'active'
     ORDER BY path COLLATE NOCASE ASC, name COLLATE NOCASE ASC`,
  )
    .bind(ownerId)
    .all<DriveFolderRow>();

  return { ok: true, folders: (result.results || []).map(serializeFolder) };
}

export async function createDriveFolder(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<{ ok: true; folder: DriveFolder }> {
  const body = assertRecord(input, "Folder payload is required");
  const name = normalizeDriveName(body.name, "Folder name");
  const parentId = normalizeOptionalId(body.parentId);
  const parent = parentId ? await requireActiveFolder(env, ownerId, parentId) : null;
  await assertFolderNameAvailable(env, ownerId, parentId, name);

  const id = crypto.randomUUID();
  const path = childFolderPath(parent?.path || "", name);

  try {
    await env.DB.prepare(
      `INSERT INTO drive_folders
         (id, owner_id, parent_id, name, path, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
    )
      .bind(id, ownerId, parentId, name, path)
      .run();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new DriveInputError("A folder with that name already exists here.", 409);
    }
    throw error;
  }

  const folder = await requireActiveFolder(env, ownerId, id);
  return { ok: true, folder: serializeFolder(folder) };
}

export async function updateDriveFolder(
  env: Env,
  ownerId: string,
  folderIdInput: string,
  input: unknown,
): Promise<{ ok: true; folder: DriveFolder }> {
  const folderId = normalizeRequiredId(folderIdInput, "Folder id");
  const body = assertRecord(input, "Folder payload is required");
  const current = await requireActiveFolder(env, ownerId, folderId);

  const name = Object.prototype.hasOwnProperty.call(body, "name")
    ? normalizeDriveName(body.name, "Folder name")
    : current.name;
  const parentSpecified = Object.prototype.hasOwnProperty.call(body, "parentId");
  const parentId = parentSpecified
    ? normalizeOptionalId(body.parentId)
    : current.parent_id;

  if (parentId === current.id) {
    throw new DriveInputError("A folder cannot be moved inside itself.");
  }

  const parent = parentId ? await requireActiveFolder(env, ownerId, parentId) : null;
  if (parent && (parent.path === current.path || parent.path.startsWith(`${current.path}/`))) {
    throw new DriveInputError("A folder cannot be moved inside one of its subfolders.");
  }

  if (name !== current.name || parentId !== current.parent_id) {
    await assertFolderNameAvailable(env, ownerId, parentId, name, current.id);
  }

  const nextPath = childFolderPath(parent?.path || "", name);
  const oldPath = current.path;

  await env.DB.prepare(
    `UPDATE drive_folders
     SET parent_id = ?, name = ?, path = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_id = ? AND status = 'active'`,
  )
    .bind(parentId, name, nextPath, current.id, ownerId)
    .run();

  if (nextPath !== oldPath) {
    await env.DB.prepare(
      `UPDATE drive_folders
       SET path = ? || substr(path, ?), updated_at = CURRENT_TIMESTAMP
       WHERE owner_id = ? AND status = 'active' AND id != ? AND path LIKE ?`,
    )
      .bind(nextPath, oldPath.length + 1, ownerId, current.id, `${oldPath}/%`)
      .run();
  }

  const folder = await requireActiveFolder(env, ownerId, current.id);
  return { ok: true, folder: serializeFolder(folder) };
}

export async function deleteDriveFolder(
  env: Env,
  ownerId: string,
  folderIdInput: string,
): Promise<{ ok: true; folderId: string }> {
  const folderId = normalizeRequiredId(folderIdInput, "Folder id");
  const folder = await requireActiveFolder(env, ownerId, folderId);

  await env.DB.prepare(
    `UPDATE drive_files
     SET status = 'trashed', updated_at = CURRENT_TIMESTAMP
     WHERE owner_id = ? AND status != 'trashed'
       AND folder_id IN (
         SELECT id FROM drive_folders
         WHERE owner_id = ? AND (id = ? OR path LIKE ?)
       )`,
  )
    .bind(ownerId, ownerId, folder.id, `${folder.path}/%`)
    .run();

  await env.DB.prepare(
    `UPDATE drive_folders
     SET status = 'trashed', updated_at = CURRENT_TIMESTAMP
     WHERE owner_id = ? AND status = 'active' AND (id = ? OR path LIKE ?)`,
  )
    .bind(ownerId, folder.id, `${folder.path}/%`)
    .run();

  return { ok: true, folderId: folder.id };
}

export async function listDriveItems(
  env: Env,
  ownerId: string,
  options: { folderId?: string | null; q?: string | null },
): Promise<DriveItems> {
  const folderId = normalizeOptionalId(options.folderId);
  if (folderId) await requireActiveFolder(env, ownerId, folderId);

  const q = normalizeSearchQuery(options.q);
  const like = q ? `%${escapeSqlLike(q)}%` : "";

  const folderRows = await queryDriveFolders(env, ownerId, folderId, like);
  const fileRows = await queryDriveFiles(env, ownerId, folderId, like);

  return {
    ok: true,
    folderId,
    q,
    folders: folderRows.map(serializeFolder),
    files: fileRows.map(serializeFile),
  };
}

export async function uploadDriveFiles(
  env: Env,
  ownerId: string,
  form: FormData,
): Promise<{ ok: true; files: DriveFile[] }> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }

  const folderId = normalizeOptionalId(form.get("folderId"));
  const folder = folderId ? await requireActiveFolder(env, ownerId, folderId) : null;
  const renameOnConflict = form.get("onConflict") === "rename";
  const entries = [...form.getAll("files"), ...form.getAll("file")];
  const files = entries.filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) throw new DriveInputError("Choose at least one file.");

  const uploaded: DriveFile[] = [];
  for (const [index, file] of files.entries()) {
    const requestedName = normalizeFilename(file.name || `file-${index + 1}`);
    if (file.size > MAX_DRIVE_UPLOAD_BYTES) {
      throw new DriveInputError(`${requestedName} is larger than ${formatByteLimit(MAX_DRIVE_UPLOAD_BYTES)}.`, 413);
    }

    const filename = renameOnConflict
      ? await availableFileName(env, ownerId, folderId, requestedName)
      : requestedName;
    if (!renameOnConflict) await assertFileNameAvailable(env, ownerId, folderId, filename);

    const id = crypto.randomUUID();
    const mimeType = normalizeFileMimeType(file.type, filename);
    const previewKind = classifyPreviewKind(filename, mimeType);
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Hex(buffer);
    const extractedText = shouldExtractText(previewKind, file.size)
      ? (await file.text()).slice(0, MAX_EXTRACTED_TEXT_CHARS)
      : null;
    const storageKey = buildDriveStorageKey(ownerId, folder?.path || "", id, filename);
    const metadata = {
      ownerId,
      folderId: folderId || "",
      filename,
      source: "files-browser",
    };

    const object = await env.SITE_ASSETS.put(storageKey, buffer, {
      httpMetadata: {
        contentType: mimeType,
      },
      customMetadata: {
        ownerId,
        folderId: folderId || "",
        fileId: id,
        filename,
      },
      sha256,
    });

    try {
      await env.DB.prepare(
        `INSERT INTO drive_files
           (id, owner_id, folder_id, filename, mime_type, size, storage_key, etag, sha256,
            status, preview_kind, extracted_text, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
      )
        .bind(
          id,
          ownerId,
          folderId,
          filename,
          mimeType,
          file.size,
          storageKey,
          object?.httpEtag || object?.etag || null,
          sha256,
          previewKind,
          extractedText,
          JSON.stringify(metadata),
        )
        .run();
    } catch (error) {
      await env.SITE_ASSETS.delete(storageKey).catch(() => undefined);
      if (isUniqueConstraintError(error)) {
        throw new DriveInputError("A file with that name already exists here.", 409);
      }
      throw error;
    }

    uploaded.push(serializeFile(await requireReadyFileRow(env, ownerId, id)));
  }

  return { ok: true, files: uploaded };
}

export async function createDriveMultipartUpload(
  env: Env,
  ownerId: string,
  input: unknown,
): Promise<{ ok: true; upload: DriveMultipartUpload }> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }

  const body = assertRecord(input, "Multipart upload payload is required");
  const requestedName = normalizeFilename(body.filename);
  const folderId = normalizeOptionalId(body.folderId);
  const renameOnConflict = body.onConflict === "rename";
  const filename = renameOnConflict
    ? await availableFileName(env, ownerId, folderId, requestedName)
    : requestedName;
  const folder = folderId ? await requireActiveFolder(env, ownerId, folderId) : null;
  const totalSize = normalizePositiveInteger(body.size, "File size");
  if (totalSize > MAX_DRIVE_MULTIPART_UPLOAD_BYTES) {
    throw new DriveInputError(
      `${filename} is larger than ${formatByteLimit(MAX_DRIVE_MULTIPART_UPLOAD_BYTES)}.`,
      413,
    );
  }
  if (!renameOnConflict) await assertFileNameAvailable(env, ownerId, folderId, filename);

  const fileId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const mimeType = normalizeFileMimeType(
    typeof body.mimeType === "string" ? body.mimeType : undefined,
    filename,
  );
  const storageKey = buildDriveStorageKey(ownerId, folder?.path || "", fileId, filename);
  const expiresAt = new Date(Date.now() + DRIVE_MULTIPART_EXPIRY_MS).toISOString();
  const multipart = await env.SITE_ASSETS.createMultipartUpload(storageKey, {
    httpMetadata: { contentType: mimeType },
    customMetadata: {
      ownerId,
      folderId: folderId || "",
      fileId,
      filename,
    },
  });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO drive_files
           (id, owner_id, folder_id, filename, mime_type, size, storage_key, status,
            preview_kind, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?)`,
      ).bind(
        fileId,
        ownerId,
        folderId,
        filename,
        mimeType,
        totalSize,
        storageKey,
        classifyPreviewKind(filename, mimeType),
        JSON.stringify({
          ownerId,
          folderId: folderId || "",
          filename,
          source: "files-browser-multipart",
        }),
      ),
      env.DB.prepare(
        `INSERT INTO drive_multipart_uploads
           (id, file_id, owner_id, storage_key, r2_upload_id, part_size, total_size,
            status, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading', ?)`,
      ).bind(
        uploadId,
        fileId,
        ownerId,
        storageKey,
        multipart.uploadId,
        DRIVE_MULTIPART_PART_BYTES,
        totalSize,
        expiresAt,
      ),
    ]);
  } catch (error) {
    await multipart.abort().catch(() => undefined);
    if (isUniqueConstraintError(error)) {
      throw new DriveInputError("A file with that name already exists here.", 409);
    }
    throw error;
  }

  return {
    ok: true,
    upload: {
      id: uploadId,
      fileId,
      filename,
      mimeType,
      partSize: DRIVE_MULTIPART_PART_BYTES,
      totalSize,
      status: "uploading",
      expiresAt,
      uploadedParts: [],
    },
  };
}

export async function getDriveMultipartUpload(
  env: Env,
  ownerId: string,
  uploadIdInput: string,
): Promise<{ ok: true; upload: DriveMultipartUpload }> {
  const uploadId = normalizeRequiredId(uploadIdInput, "Upload id");
  const row = await requireMultipartUploadRow(env, ownerId, uploadId);
  return { ok: true, upload: await serializeMultipartUpload(env, row) };
}

export async function uploadDriveMultipartPart(
  env: Env,
  ownerId: string,
  uploadIdInput: string,
  partNumberInput: string,
  body: ReadableStream,
  options: { contentLength?: string | null; contentRange?: string | null },
): Promise<{ ok: true; part: { partNumber: number; etag: string; size: number } }> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }
  const uploadId = normalizeRequiredId(uploadIdInput, "Upload id");
  const partNumber = normalizePartNumber(partNumberInput);
  const row = await requireActiveMultipartUploadRow(env, ownerId, uploadId);
  const totalSize = Number(row.total_size);
  const partSize = Number(row.part_size);
  const expectedStart = (partNumber - 1) * partSize;
  if (expectedStart >= totalSize) throw new DriveInputError("Upload part is outside the file.");
  const expectedSize = Math.min(partSize, totalSize - expectedStart);
  const contentLength = normalizePositiveInteger(options.contentLength, "Content-Length");
  if (contentLength !== expectedSize) {
    throw new DriveInputError(`Upload part ${partNumber} must contain ${expectedSize} bytes.`);
  }
  const expectedRange = `bytes ${expectedStart}-${expectedStart + expectedSize - 1}/${totalSize}`;
  if (options.contentRange?.trim() !== expectedRange) {
    throw new DriveInputError(`Content-Range must be ${expectedRange}.`);
  }

  const multipart = env.SITE_ASSETS.resumeMultipartUpload(row.storage_key, row.r2_upload_id);
  const part = await multipart.uploadPart(partNumber, body);
  await env.DB.prepare(
    `INSERT INTO drive_multipart_parts (upload_id, part_number, etag, size)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(upload_id, part_number) DO UPDATE SET
       etag = excluded.etag,
       size = excluded.size,
       updated_at = CURRENT_TIMESTAMP`,
  )
    .bind(uploadId, part.partNumber, part.etag, contentLength)
    .run();
  await env.DB.prepare(
    `UPDATE drive_multipart_uploads SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_id = ? AND status = 'uploading'`,
  )
    .bind(uploadId, ownerId)
    .run();

  return { ok: true, part: { partNumber: part.partNumber, etag: part.etag, size: contentLength } };
}

export async function completeDriveMultipartUpload(
  env: Env,
  ownerId: string,
  uploadIdInput: string,
): Promise<{ ok: true; file: DriveFile }> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }
  const uploadId = normalizeRequiredId(uploadIdInput, "Upload id");
  const row = await requireMultipartUploadRow(env, ownerId, uploadId);
  if (row.status === "completed") {
    return { ok: true, file: serializeFile(await requireReadyFileRow(env, ownerId, row.file_id)) };
  }
  assertActiveMultipartUpload(row);
  const parts = await listMultipartPartRows(env, uploadId);
  const partSize = Number(row.part_size);
  const totalSize = Number(row.total_size);
  const expectedCount = Math.ceil(totalSize / partSize);
  if (parts.length !== expectedCount) {
    throw new DriveInputError(`Upload is incomplete (${parts.length} of ${expectedCount} parts).`, 409);
  }
  for (const [index, part] of parts.entries()) {
    const expectedPartNumber = index + 1;
    const expectedSize = Math.min(partSize, totalSize - index * partSize);
    if (Number(part.part_number) !== expectedPartNumber || Number(part.size) !== expectedSize) {
      throw new DriveInputError(`Upload part ${expectedPartNumber} is incomplete.`, 409);
    }
  }

  const multipart = env.SITE_ASSETS.resumeMultipartUpload(row.storage_key, row.r2_upload_id);
  let object: R2Object;
  try {
    object = await multipart.complete(
      parts.map((part) => ({ partNumber: Number(part.part_number), etag: part.etag })),
    );
  } catch (error) {
    const existing = await env.SITE_ASSETS.head(row.storage_key);
    if (!existing || existing.size !== totalSize) throw error;
    object = existing;
  }
  if (object.size !== totalSize) {
    throw new DriveInputError("Completed upload size does not match the selected file.", 409);
  }
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE drive_files
       SET status = 'ready', etag = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ? AND status = 'uploading'`,
    ).bind(object.httpEtag || object.etag || null, row.file_id, ownerId),
    env.DB.prepare(
      `UPDATE drive_multipart_uploads
       SET status = 'completed', updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ? AND status = 'uploading'`,
    ).bind(uploadId, ownerId),
  ]);

  return { ok: true, file: serializeFile(await requireReadyFileRow(env, ownerId, row.file_id)) };
}

export async function abortDriveMultipartUpload(
  env: Env,
  ownerId: string,
  uploadIdInput: string,
): Promise<{ ok: true; uploadId: string }> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }
  const uploadId = normalizeRequiredId(uploadIdInput, "Upload id");
  const row = await requireMultipartUploadRow(env, ownerId, uploadId);
  if (row.status === "uploading") {
    await env.SITE_ASSETS.resumeMultipartUpload(row.storage_key, row.r2_upload_id).abort();
  }
  await env.DB.prepare("DELETE FROM drive_files WHERE id = ? AND owner_id = ? AND status = 'uploading'")
    .bind(row.file_id, ownerId)
    .run();
  return { ok: true, uploadId };
}

export async function updateDriveFile(
  env: Env,
  ownerId: string,
  fileIdInput: string,
  input: unknown,
): Promise<{ ok: true; file: DriveFile }> {
  const fileId = normalizeRequiredId(fileIdInput, "File id");
  const body = assertRecord(input, "File payload is required");
  const current = await requireReadyFileRow(env, ownerId, fileId);

  const filename = Object.prototype.hasOwnProperty.call(body, "filename")
    ? normalizeFilename(body.filename)
    : current.filename;
  const folderSpecified = Object.prototype.hasOwnProperty.call(body, "folderId");
  const folderId = folderSpecified
    ? normalizeOptionalId(body.folderId)
    : current.folder_id;
  const folder = folderId ? await requireActiveFolder(env, ownerId, folderId) : null;

  if (filename !== current.filename || folderId !== current.folder_id) {
    await assertFileNameAvailable(env, ownerId, folderId, filename, current.id);
  }

  const isSharedAssistantAsset = await isAssistantAttachmentStorageKey(
    env,
    ownerId,
    current.storage_key,
  );
  const nextStorageKey = isSharedAssistantAsset
    ? current.storage_key
    : buildDriveStorageKey(ownerId, folder?.path || "", current.id, filename);
  const storageKeyChanged = nextStorageKey !== current.storage_key;
  let copiedToNextKey = false;

  if (storageKeyChanged) {
    if (!env.SITE_ASSETS) {
      throw new DriveInputError("File storage is not configured.", 503);
    }
    const object = await env.SITE_ASSETS.get(current.storage_key);
    if (!object) throw new DriveInputError("File bytes were not found.", 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    await env.SITE_ASSETS.put(nextStorageKey, await object.arrayBuffer(), {
      httpMetadata: {
        contentType: headers.get("Content-Type") || current.mime_type,
      },
      customMetadata: {
        ownerId,
        folderId: folderId || "",
        fileId: current.id,
        filename,
      },
      sha256: current.sha256 || undefined,
    });
    copiedToNextKey = true;
  }

  const mimeType =
    filename === current.filename
      ? current.mime_type
      : normalizeFileMimeType(current.mime_type, filename);
  const previewKind = classifyPreviewKind(filename, mimeType);

  try {
    await env.DB.prepare(
      `UPDATE drive_files
       SET folder_id = ?, filename = ?, mime_type = ?, storage_key = ?,
           preview_kind = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND owner_id = ? AND status = 'ready'`,
    )
      .bind(folderId, filename, mimeType, nextStorageKey, previewKind, current.id, ownerId)
      .run();
  } catch (error) {
    if (copiedToNextKey) await env.SITE_ASSETS?.delete(nextStorageKey).catch(() => undefined);
    if (isUniqueConstraintError(error)) {
      throw new DriveInputError("A file with that name already exists here.", 409);
    }
    throw error;
  }

  if (storageKeyChanged) {
    await env.SITE_ASSETS?.delete(current.storage_key).catch(() => undefined);
  }

  return { ok: true, file: serializeFile(await requireReadyFileRow(env, ownerId, current.id)) };
}

export async function deleteDriveFile(
  env: Env,
  ownerId: string,
  fileIdInput: string,
): Promise<{ ok: true; fileId: string }> {
  const fileId = normalizeRequiredId(fileIdInput, "File id");
  const current = await requireReadyFileRow(env, ownerId, fileId);

  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }

  const isSharedAssistantAsset = await isAssistantAttachmentStorageKey(
    env,
    ownerId,
    current.storage_key,
  );
  if (!isSharedAssistantAsset) {
    await env.SITE_ASSETS.delete(current.storage_key);
  }

  const result = await env.DB.prepare(
    `UPDATE drive_files
     SET status = 'trashed', updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND owner_id = ? AND status = 'ready'`,
  )
    .bind(fileId, ownerId)
    .run();

  if ((result.meta?.changes || 0) === 0) {
    throw new DriveInputError("File not found.", 404);
  }

  return { ok: true, fileId };
}

export async function getDriveFilePreview(
  env: Env,
  ownerId: string,
  fileIdInput: string,
): Promise<DrivePreview> {
  const fileId = normalizeRequiredId(fileIdInput, "File id");
  const row = await requireReadyFileRow(env, ownerId, fileId);
  const file = serializeFile(row);
  const previewKind = file.previewKind;

  if (!isTextPreviewKind(previewKind)) {
    return {
      ok: true,
      file,
      previewKind,
      truncated: false,
    };
  }

  if (row.extracted_text !== null && file.size <= MAX_PREVIEW_BYTES) {
    return {
      ok: true,
      file,
      previewKind,
      text: row.extracted_text,
      truncated: row.extracted_text.length >= MAX_EXTRACTED_TEXT_CHARS,
    };
  }

  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }

  const object = await env.SITE_ASSETS.get(row.storage_key, {
    range: { offset: 0, length: MAX_PREVIEW_BYTES },
  });
  if (!object) throw new DriveInputError("File not found.", 404);

  return {
    ok: true,
    file,
    previewKind,
    text: await object.text(),
    truncated: file.size > MAX_PREVIEW_BYTES,
  };
}

export async function getDriveFileContentResponse(
  env: Env,
  ownerId: string,
  fileIdInput: string,
  options: { download?: boolean; rangeHeader?: string | null } = {},
): Promise<Response> {
  if (!env.SITE_ASSETS) {
    throw new DriveInputError("File storage is not configured.", 503);
  }

  const fileId = normalizeRequiredId(fileIdInput, "File id");
  const row = await requireReadyFileRow(env, ownerId, fileId);
  const range = parseSingleByteRange(options.rangeHeader, Number(row.size || 0));
  if (range === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${Number(row.size || 0)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const object = await env.SITE_ASSETS.get(
    row.storage_key,
    range ? { range: { offset: range.start, length: range.length } } : undefined,
  );
  if (!object) throw new DriveInputError("File not found.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", headers.get("Content-Type") || row.mime_type);
  headers.set("Content-Length", String(range?.length ?? object.size));
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${Number(row.size || 0)}`);
  }
  headers.set("Cache-Control", "private, max-age=300");
  headers.set(
    "Content-Disposition",
    `${options.download ? "attachment" : "inline"}; filename="${sanitizeContentDispositionFilename(row.filename)}"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");

  return new Response(object.body, { status: range ? 206 : 200, headers });
}

export function parseSingleByteRange(
  value: string | null | undefined,
  size: number,
): { start: number; end: number; length: number } | "invalid" | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || size <= 0) return "invalid";
  const startText = match[1] || "";
  const endText = match[2] || "";
  if (!startText && !endText) return "invalid";

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid";
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return "invalid";
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(end) || end < start) return "invalid";
    end = Math.min(end, size - 1);
  }
  return { start, end, length: end - start + 1 };
}

export function isMissingDriveTablesError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /drive_(folders|files)/i.test(message) &&
    /no such table|does not exist|not found|no such object/i.test(message)
  );
}

function assertRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DriveInputError(message);
  }
  return value as Record<string, unknown>;
}

function normalizeRequiredId(value: unknown, label: string): string {
  const id = normalizeOptionalId(value);
  if (!id) throw new DriveInputError(`${label} is required.`);
  return id;
}

function normalizeOptionalId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id) return null;
  if (id.length > 100 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new DriveInputError("Identifier is invalid.");
  }
  return id;
}

function normalizeSearchQuery(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 120);
}

function normalizeDriveName(value: unknown, label: string): string {
  if (typeof value !== "string") throw new DriveInputError(`${label} is required.`);
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) throw new DriveInputError(`${label} is required.`);
  if (name.length > MAX_NAME_LENGTH) {
    throw new DriveInputError(`${label} must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }
  if (/[\/\\]/.test(name) || name === "." || name === ".." || name.includes("..")) {
    throw new DriveInputError(`${label} cannot contain path separators.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new DriveInputError(`${label} cannot contain control characters.`);
  }
  return name;
}

function normalizeFilename(value: unknown): string {
  const filename = normalizeDriveName(value, "Filename");
  if (filename.startsWith(".")) {
    throw new DriveInputError("Filename cannot start with a dot.");
  }
  return filename;
}

function normalizeFileMimeType(rawType: string | undefined, filename: string): string {
  const explicit = (rawType || "").trim().toLowerCase();
  const extension = extensionForName(filename);

  if (explicit && explicit !== "application/octet-stream") return explicit;
  if (extension === ".md" || extension === ".markdown" || extension === ".mdown") return "text/markdown";
  if (extension === ".csv") return "text/csv";
  if (extension === ".tsv") return "text/tab-separated-values";
  if (extension === ".json") return "application/json";
  if (extension === ".xml") return "application/xml";
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".txt" || extension === ".log") return "text/plain";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".mp4" || extension === ".m4v") return "video/mp4";
  if (extension === ".mov") return "video/quicktime";
  if (extension === ".webm") return "video/webm";
  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === ".xls") return "application/vnd.ms-excel";
  if (extension === ".ods") return "application/vnd.oasis.opendocument.spreadsheet";
  return explicit || "application/octet-stream";
}

function classifyPreviewKind(filename: string, mimeType: string): DrivePreviewKind {
  const type = mimeType.toLowerCase();
  const extension = extensionForName(filename);

  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || extension === ".pdf") return "pdf";
  if (type === "text/markdown" || MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (
    type === "text/csv" ||
    type === "text/tab-separated-values" ||
    CSV_EXTENSIONS.has(extension)
  ) {
    return "csv";
  }
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    type === "application/xml" ||
    TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }
  if (SPREADSHEET_MIME_TYPES.has(type) || SPREADSHEET_EXTENSIONS.has(extension)) {
    return "spreadsheet";
  }
  return "download";
}

function isTextPreviewKind(value: DrivePreviewKind): value is "text" | "markdown" | "csv" {
  return value === "text" || value === "markdown" || value === "csv";
}

function shouldExtractText(previewKind: DrivePreviewKind, size: number): boolean {
  return isTextPreviewKind(previewKind) && size <= MAX_PREVIEW_BYTES;
}

async function isAssistantAttachmentStorageKey(
  env: Pick<Env, "DB">,
  ownerId: string,
  storageKey: string,
): Promise<boolean> {
  const attachment = await env.DB.prepare(
    `SELECT id
     FROM assistant_attachments
     WHERE owner_id = ? AND storage_key = ? AND status = 'ready'
     LIMIT 1`,
  )
    .bind(ownerId, storageKey)
    .first<{ id: string }>();
  return Boolean(attachment?.id);
}

async function queryDriveFolders(
  env: Env,
  ownerId: string,
  folderId: string | null,
  like: string,
): Promise<DriveFolderRow[]> {
  const base =
    `SELECT id, owner_id, parent_id, name, path, status, created_at, updated_at
     FROM drive_folders
     WHERE owner_id = ? AND status = 'active'`;
  const folderClause = folderId ? " AND parent_id = ?" : " AND parent_id IS NULL";
  const searchClause = like ? " AND name LIKE ? ESCAPE '\\'" : "";
  const result = await env.DB.prepare(
    `${base}${folderClause}${searchClause}
     ORDER BY name COLLATE NOCASE ASC`,
  )
    .bind(...compactBindValues([ownerId, folderId, like]))
    .all<DriveFolderRow>();
  return result.results || [];
}

async function queryDriveFiles(
  env: Env,
  ownerId: string,
  folderId: string | null,
  like: string,
): Promise<DriveFileRow[]> {
  const base =
    `SELECT id, owner_id, folder_id, filename, mime_type, size, storage_key, etag,
            sha256, status, preview_kind, extracted_text, metadata_json,
            created_at, updated_at
     FROM drive_files
     WHERE owner_id = ? AND status = 'ready'`;
  const folderClause = folderId ? " AND folder_id = ?" : " AND folder_id IS NULL";
  const searchClause = like
    ? " AND (filename LIKE ? ESCAPE '\\' OR mime_type LIKE ? ESCAPE '\\' OR extracted_text LIKE ? ESCAPE '\\')"
    : "";
  const result = await env.DB.prepare(
    `${base}${folderClause}${searchClause}
     ORDER BY filename COLLATE NOCASE ASC`,
  )
    .bind(...compactBindValues([ownerId, folderId, like, like, like]))
    .all<DriveFileRow>();
  return result.results || [];
}

function compactBindValues(values: Array<string | null>): string[] {
  return values.filter((value): value is string => value !== null && value !== "");
}

async function requireActiveFolder(
  env: Env,
  ownerId: string,
  folderId: string,
): Promise<DriveFolderRow> {
  const row = await env.DB.prepare(
    `SELECT id, owner_id, parent_id, name, path, status, created_at, updated_at
     FROM drive_folders
     WHERE id = ? AND owner_id = ? AND status = 'active'
     LIMIT 1`,
  )
    .bind(folderId, ownerId)
    .first<DriveFolderRow>();
  if (!row) throw new DriveInputError("Folder not found.", 404);
  return row;
}

async function requireReadyFileRow(
  env: Env,
  ownerId: string,
  fileId: string,
): Promise<DriveFileRow> {
  const row = await env.DB.prepare(
    `SELECT id, owner_id, folder_id, filename, mime_type, size, storage_key, etag,
            sha256, status, preview_kind, extracted_text, metadata_json,
            created_at, updated_at
     FROM drive_files
     WHERE id = ? AND owner_id = ? AND status = 'ready'
     LIMIT 1`,
  )
    .bind(fileId, ownerId)
    .first<DriveFileRow>();
  if (!row) throw new DriveInputError("File not found.", 404);
  return row;
}

async function requireMultipartUploadRow(
  env: Env,
  ownerId: string,
  uploadId: string,
): Promise<DriveMultipartUploadRow> {
  const row = await env.DB.prepare(
    `SELECT upload.id, upload.file_id, upload.owner_id, file.filename, file.mime_type,
            upload.storage_key, upload.r2_upload_id, upload.part_size, upload.total_size,
            upload.status, upload.expires_at
     FROM drive_multipart_uploads upload
     JOIN drive_files file ON file.id = upload.file_id AND file.owner_id = upload.owner_id
     WHERE upload.id = ? AND upload.owner_id = ?
     LIMIT 1`,
  )
    .bind(uploadId, ownerId)
    .first<DriveMultipartUploadRow>();
  if (!row) throw new DriveInputError("Multipart upload not found.", 404);
  return row;
}

async function requireActiveMultipartUploadRow(
  env: Env,
  ownerId: string,
  uploadId: string,
): Promise<DriveMultipartUploadRow> {
  const row = await requireMultipartUploadRow(env, ownerId, uploadId);
  assertActiveMultipartUpload(row);
  return row;
}

function assertActiveMultipartUpload(row: DriveMultipartUploadRow): void {
  if (row.status !== "uploading") {
    throw new DriveInputError("Multipart upload is no longer active.", 409);
  }
  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new DriveInputError("Multipart upload has expired. Start it again.", 410);
  }
}

async function listMultipartPartRows(
  env: Env,
  uploadId: string,
): Promise<DriveMultipartPartRow[]> {
  const result = await env.DB.prepare(
    `SELECT part_number, etag, size
     FROM drive_multipart_parts
     WHERE upload_id = ?
     ORDER BY part_number ASC`,
  )
    .bind(uploadId)
    .all<DriveMultipartPartRow>();
  return result.results || [];
}

async function serializeMultipartUpload(
  env: Env,
  row: DriveMultipartUploadRow,
): Promise<DriveMultipartUpload> {
  const parts = await listMultipartPartRows(env, row.id);
  return {
    id: row.id,
    fileId: row.file_id,
    filename: row.filename,
    mimeType: row.mime_type,
    partSize: Number(row.part_size),
    totalSize: Number(row.total_size),
    status: row.status,
    expiresAt: row.expires_at,
    uploadedParts: parts.map((part) => ({
      partNumber: Number(part.part_number),
      etag: part.etag,
      size: Number(part.size),
    })),
  };
}

async function assertFolderNameAvailable(
  env: Env,
  ownerId: string,
  parentId: string | null,
  name: string,
  exceptId?: string,
): Promise<void> {
  const sql =
    `SELECT id FROM drive_folders
     WHERE owner_id = ? AND status = 'active' AND name = ? COLLATE NOCASE` +
    (parentId ? " AND parent_id = ?" : " AND parent_id IS NULL") +
    (exceptId ? " AND id != ?" : "") +
    " LIMIT 1";
  const row = await env.DB.prepare(sql)
    .bind(...compactBindValues([ownerId, name, parentId, exceptId || null]))
    .first<{ id: string }>();
  if (row) throw new DriveInputError("A folder with that name already exists here.", 409);
}

/** "photo.jpg" → "photo (2).jpg" → … until the name is free in that folder. */
async function availableFileName(
  env: Env,
  ownerId: string,
  folderId: string | null,
  filename: string,
): Promise<string> {
  const dot = filename.lastIndexOf(".");
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : "";
  for (let copy = 1; copy <= 50; copy += 1) {
    const candidate = copy === 1 ? filename : `${stem} (${copy})${extension}`;
    const taken = await assertFileNameAvailable(env, ownerId, folderId, candidate).then(
      () => false,
      (error) => (error instanceof DriveInputError && error.status === 409 ? true : Promise.reject(error)),
    );
    if (!taken) return candidate;
  }
  return `${stem} (${crypto.randomUUID().slice(0, 8)})${extension}`;
}

async function assertFileNameAvailable(
  env: Env,
  ownerId: string,
  folderId: string | null,
  filename: string,
  exceptId?: string,
): Promise<void> {
  const sql =
    `SELECT id FROM drive_files
     WHERE owner_id = ? AND status = 'ready' AND filename = ? COLLATE NOCASE` +
    (folderId ? " AND folder_id = ?" : " AND folder_id IS NULL") +
    (exceptId ? " AND id != ?" : "") +
    " LIMIT 1";
  const row = await env.DB.prepare(sql)
    .bind(...compactBindValues([ownerId, filename, folderId, exceptId || null]))
    .first<{ id: string }>();
  if (row) throw new DriveInputError("A file with that name already exists here.", 409);
}

function serializeFolder(row: DriveFolderRow): DriveFolder {
  return {
    id: row.id,
    ownerId: row.owner_id,
    parentId: row.parent_id,
    name: row.name,
    path: row.path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeFile(row: DriveFileRow): DriveFile {
  return {
    id: row.id,
    ownerId: row.owner_id,
    folderId: row.folder_id,
    filename: row.filename,
    mimeType: row.mime_type,
    size: Number(row.size || 0),
    etag: row.etag,
    sha256: row.sha256,
    status: row.status,
    previewKind: row.preview_kind,
    metadata: parseMetadataJson(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseMetadataJson(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function childFolderPath(parentPath: string, name: string): string {
  const segment = safeStorageSegment(name, "folder");
  return parentPath ? `${parentPath}/${segment}` : segment;
}

function buildDriveStorageKey(
  ownerId: string,
  folderPath: string,
  fileId: string,
  filename: string,
): string {
  const parts = ["drive", safeStorageSegment(ownerId, "owner")];
  if (folderPath) parts.push(...folderPath.split("/").filter(Boolean));
  parts.push(`${fileId}-${safeStorageSegment(filename, "file")}`);
  return parts.join("/");
}

function safeStorageSegment(value: string, fallback: string): string {
  const segment = value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\/\\]+/g, "-")
    .replace(/[^a-zA-Z0-9._@() -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return segment || fallback;
}

function sanitizeContentDispositionFilename(filename: string): string {
  return filename.replace(/[\r\n"]/g, "'").slice(0, MAX_NAME_LENGTH);
}

function extensionForName(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) {
    throw new DriveInputError(`${label} must be a positive integer.`);
  }
  return number;
}

function normalizePartNumber(value: unknown): number {
  const partNumber = normalizePositiveInteger(value, "Part number");
  if (partNumber > 10_000) throw new DriveInputError("Part number is too large.");
  return partNumber;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /unique constraint|constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function formatByteLimit(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${Math.round(bytes / 100_000) / 10} MB`;
}
