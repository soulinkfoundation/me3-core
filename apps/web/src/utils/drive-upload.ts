import { API_BASE, ApiError, api } from "../api";

export type DriveUploadProgress = {
  filename: string;
  percent: number;
};

export type DriveUploadRecord = {
  id: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  size: number;
  status: string;
};

type MultipartUpload = {
  id: string;
  filename: string;
  mimeType: string;
  partSize: number;
  totalSize: number;
  status: "uploading" | "completed" | "aborted" | "failed";
  expiresAt: string;
  uploadedParts: Array<{ partNumber: number; etag: string; size: number }>;
};

type UploadOptions = {
  folderId: string | null;
  /** "rename" saves "photo (2).jpg" instead of failing when the name is taken. */
  onConflict?: "rename";
  onProgress?: (progress: DriveUploadProgress) => void;
};

const MULTIPART_THRESHOLD_BYTES = 50 * 1024 * 1024;

export function usesMultipartDriveUpload(
  file: Pick<File, "size" | "type">,
): boolean {
  return file.type.startsWith("video/") || file.size > MULTIPART_THRESHOLD_BYTES;
}

export async function uploadDriveFiles<T extends DriveUploadRecord>(
  files: FileList | readonly File[],
  options: UploadOptions,
): Promise<T[]> {
  const uploaded: T[] = [];
  for (const file of Array.from(files)) {
    options.onProgress?.({ filename: file.name, percent: 0 });
    uploaded.push(
      usesMultipartDriveUpload(file)
        ? await uploadMultipartFile<T>(file, options)
        : await uploadSimpleFile<T>(file, options),
    );
  }
  return uploaded;
}

async function uploadSimpleFile<T extends DriveUploadRecord>(
  file: File,
  options: UploadOptions,
): Promise<T> {
  const form = new FormData();
  if (options.folderId) form.append("folderId", options.folderId);
  if (options.onConflict) form.append("onConflict", options.onConflict);
  form.append("files", file);
  const response = await api.upload<{ ok: true; files: T[] }>("/files/upload", form);
  const uploaded = response.files[0];
  if (!uploaded) throw new Error("The upload completed without a Files record.");
  options.onProgress?.({ filename: file.name, percent: 100 });
  return uploaded;
}

async function uploadMultipartFile<T extends DriveUploadRecord>(
  file: File,
  options: UploadOptions,
): Promise<T> {
  const storageKey = multipartStorageKey(file, options.folderId);
  let upload = await resumeStoredMultipartUpload(storageKey, file);
  if (!upload) {
    const response = await requestFilesJson<{ ok: true; upload: MultipartUpload }>(
      "/files/multipart",
      {
        method: "POST",
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          folderId: options.folderId,
          onConflict: options.onConflict,
        }),
      },
    );
    upload = response.upload;
    window.localStorage.setItem(storageKey, upload.id);
  }

  if (upload.status === "completed") {
    const completed = await completeMultipartUpload<T>(upload.id);
    window.localStorage.removeItem(storageKey);
    options.onProgress?.({ filename: file.name, percent: 100 });
    return completed;
  }

  const uploadedPartNumbers = new Set(upload.uploadedParts.map((part) => part.partNumber));
  const partCount = Math.ceil(file.size / upload.partSize);
  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const start = (partNumber - 1) * upload.partSize;
    const end = Math.min(start + upload.partSize, file.size);
    if (!uploadedPartNumbers.has(partNumber)) {
      const part = file.slice(start, end, file.type || "application/octet-stream");
      await uploadMultipartPartWithRetry(upload.id, partNumber, part, start, end, file.size);
    }
    options.onProgress?.({
      filename: file.name,
      percent: Math.round((end / file.size) * 100),
    });
  }

  const completed = await completeMultipartUpload<T>(upload.id);
  window.localStorage.removeItem(storageKey);
  return completed;
}

async function completeMultipartUpload<T extends DriveUploadRecord>(
  uploadId: string,
): Promise<T> {
  const response = await requestFilesJson<{ ok: true; file: T }>(
    `/files/multipart/${encodeURIComponent(uploadId)}/complete`,
    { method: "POST", body: "{}" },
  );
  if (!response.file) throw new Error("The upload completed without a Files record.");
  return response.file;
}

async function resumeStoredMultipartUpload(
  storageKey: string,
  file: File,
): Promise<MultipartUpload | null> {
  const uploadId = window.localStorage.getItem(storageKey);
  if (!uploadId) return null;
  try {
    const response = await requestFilesJson<{ ok: true; upload: MultipartUpload }>(
      `/files/multipart/${encodeURIComponent(uploadId)}`,
    );
    const upload = response.upload;
    if (
      (upload.status === "uploading" || upload.status === "completed") &&
      upload.filename === file.name &&
      upload.totalSize === file.size &&
      (upload.status === "completed" || Date.parse(upload.expiresAt) > Date.now())
    ) {
      return upload;
    }
  } catch {
    // A missing or expired session is replaced below.
  }
  window.localStorage.removeItem(storageKey);
  return null;
}

async function uploadMultipartPartWithRetry(
  uploadId: string,
  partNumber: number,
  part: Blob,
  start: number,
  end: number,
  totalSize: number,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await requestFilesJson(
        `/files/multipart/${encodeURIComponent(uploadId)}/parts/${partNumber}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": part.type || "application/octet-stream",
            "Content-Range": `bytes ${start}-${end - 1}/${totalSize}`,
            "X-Upload-Part-Size": String(part.size),
          },
          body: part,
        },
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("A video upload part failed.");
}

async function requestFilesJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(body.error || "Upload request failed", response.status);
  return body as T;
}

function multipartStorageKey(file: File, folderId: string | null): string {
  return [
    "me3:multipart-upload",
    folderId || "root",
    file.name,
    file.size,
    file.lastModified,
  ].join(":");
}
