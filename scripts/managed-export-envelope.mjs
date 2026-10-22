#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  closeSync,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { validateArchive } from "./portable-v1.mjs";

export const MANAGED_EXPORT_ENVELOPE_FORMAT = "me3-managed-export-v1";
const MAGIC = Buffer.from("ME3MEXP1", "ascii");
const HEADER_LENGTH_BYTES = 4;
const SCRYPT_N = 32768;
const KEY_VERSION_PATTERN = /^v[1-9][0-9]{0,8}$/;

export function deriveManagedExportPassphrase(masterKey, installationId, operationId) {
  requireSecret(masterKey, "Managed export master key");
  validateIdentity(installationId, operationId);
  return createHmac("sha256", masterKey)
    .update(`${MANAGED_EXPORT_ENVELOPE_FORMAT}\0${installationId}\0${operationId}`)
    .digest("base64url");
}

export function resolveManagedExportMasterKey(keyringJson, keyVersion) {
  validateKeyVersion(keyVersion);
  let keyring;
  try {
    keyring = JSON.parse(keyringJson || "");
  } catch {
    throw new Error("Managed export keyring is unavailable");
  }
  if (!keyring || Array.isArray(keyring) || typeof keyring !== "object") {
    throw new Error("Managed export keyring is unavailable");
  }
  for (const [version, key] of Object.entries(keyring)) {
    validateKeyVersion(version);
    requireSecret(key, `Managed export key ${version}`);
  }
  const masterKey = keyring[keyVersion];
  requireSecret(masterKey, `Managed export key ${keyVersion}`);
  return masterKey;
}

export async function createManagedExportEnvelope({
  archive,
  output,
  passphrase,
  installationId,
  operationId,
  keyVersion,
}) {
  requireSecret(passphrase, "Managed export passphrase");
  validateIdentity(installationId, operationId);
  validateKeyVersion(keyVersion);
  const source = resolve(archive);
  const destination = resolve(output);
  if (!existsSync(join(source, "manifest.json"))) {
    throw new Error("portable-v1 archive manifest is missing");
  }
  if (existsSync(destination)) throw new Error("managed export envelope output already exists");

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "me3-managed-envelope-"));
  const plaintextPath = join(temporaryDirectory, "portable.tar.gz");
  const ciphertextPath = join(temporaryDirectory, "portable.enc");
  const temporaryOutput = `${destination}.tmp-${process.pid}`;
  try {
    runTar(["-czf", plaintextPath, "-C", dirname(source), basename(source)]);
    const plaintextSha256 = await sha256File(plaintextPath);
    const plaintextBytes = statSync(plaintextPath).size;
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const authenticatedHeader = {
      format: MANAGED_EXPORT_ENVELOPE_FORMAT,
      cipher: "aes-256-gcm",
      kdf: { name: "scrypt", N: SCRYPT_N, r: 8, p: 1, salt: salt.toString("base64") },
      iv: iv.toString("base64"),
      installationId,
      operationId,
      keyVersion,
      plaintextBytes,
      plaintextSha256,
    };
    const authenticatedBytes = Buffer.from(stableJson(authenticatedHeader));
    const key = scryptSync(passphrase, salt, 32, {
      N: SCRYPT_N,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(authenticatedBytes);
    await pipeline(createReadStream(plaintextPath), cipher, createWriteStream(ciphertextPath, { mode: 0o600 }));
    key.fill(0);
    const ciphertextSha256 = await sha256File(ciphertextPath);
    const header = {
      ...authenticatedHeader,
      authTag: cipher.getAuthTag().toString("base64"),
      ciphertextBytes: statSync(ciphertextPath).size,
      ciphertextSha256,
    };
    const headerBytes = Buffer.from(`${stableJson(header)}\n`);
    const headerLength = Buffer.alloc(HEADER_LENGTH_BYTES);
    headerLength.writeUInt32BE(headerBytes.length);
    writeFileSync(temporaryOutput, Buffer.concat([MAGIC, headerLength, headerBytes]), { mode: 0o600 });
    await pipeline(
      createReadStream(ciphertextPath),
      createWriteStream(temporaryOutput, { flags: "a", mode: 0o600 }),
    );
    const verified = await verifyManagedExportEnvelope({
      envelope: temporaryOutput,
      passphrase,
      expectedInstallationId: installationId,
      expectedOperationId: operationId,
      expectedKeyVersion: keyVersion,
    });
    renameSync(temporaryOutput, destination);
    return { ...verified, envelope: destination, envelopeSha256: await sha256File(destination) };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    rmSync(temporaryOutput, { force: true });
  }
}

export async function verifyManagedExportEnvelope({
  envelope,
  passphrase,
  expectedInstallationId,
  expectedOperationId,
  expectedKeyVersion,
  decryptedArchiveOutput,
}) {
  requireSecret(passphrase, "Managed export passphrase");
  const source = resolve(envelope);
  const { header, payloadOffset } = readEnvelopeHeader(source);
  if (
    header.format !== MANAGED_EXPORT_ENVELOPE_FORMAT ||
    header.cipher !== "aes-256-gcm" ||
    header.kdf?.name !== "scrypt" ||
    header.kdf?.N !== SCRYPT_N ||
    header.kdf?.r !== 8 ||
    header.kdf?.p !== 1 ||
    (expectedInstallationId && header.installationId !== expectedInstallationId) ||
    (expectedOperationId && header.operationId !== expectedOperationId) ||
    (expectedKeyVersion && header.keyVersion !== expectedKeyVersion)
  ) {
    throw new Error("managed export envelope header is invalid");
  }
  validateIdentity(header.installationId, header.operationId);
  validateKeyVersion(header.keyVersion);
  const payloadBytes = statSync(source).size - payloadOffset;
  if (payloadBytes !== header.ciphertextBytes) {
    throw new Error("managed export envelope payload length is invalid");
  }
  const ciphertextSha256 = await sha256File(source, payloadOffset);
  if (ciphertextSha256 !== header.ciphertextSha256) {
    throw new Error("managed export envelope ciphertext checksum is invalid");
  }

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "me3-managed-verify-"));
  const plaintextPath = decryptedArchiveOutput
    ? resolve(decryptedArchiveOutput)
    : join(temporaryDirectory, "portable.tar.gz");
  if (decryptedArchiveOutput && existsSync(plaintextPath)) {
    throw new Error("managed export plaintext output already exists");
  }
  try {
    const salt = Buffer.from(header.kdf.salt, "base64");
    const iv = Buffer.from(header.iv, "base64");
    const tag = Buffer.from(header.authTag, "base64");
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) {
      throw new Error("managed export envelope cryptographic header is invalid");
    }
    const authenticatedHeader = {
      format: header.format,
      cipher: header.cipher,
      kdf: header.kdf,
      iv: header.iv,
      installationId: header.installationId,
      operationId: header.operationId,
      keyVersion: header.keyVersion,
      plaintextBytes: header.plaintextBytes,
      plaintextSha256: header.plaintextSha256,
    };
    const key = scryptSync(passphrase, salt, 32, {
      N: SCRYPT_N,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(stableJson(authenticatedHeader)));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(source, { start: payloadOffset }),
      decipher,
      createWriteStream(plaintextPath, { mode: 0o600 }),
    );
    key.fill(0);
    if (
      statSync(plaintextPath).size !== header.plaintextBytes ||
      (await sha256File(plaintextPath)) !== header.plaintextSha256
    ) {
      throw new Error("managed export envelope plaintext checksum is invalid");
    }
    runTar(["-tzf", plaintextPath]);
    return {
      ok: true,
      format: header.format,
      installationId: header.installationId,
      operationId: header.operationId,
      keyVersion: header.keyVersion,
      plaintextBytes: header.plaintextBytes,
      plaintextSha256: header.plaintextSha256,
      ciphertextBytes: header.ciphertextBytes,
      ciphertextSha256: header.ciphertextSha256,
    };
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

// coreFromArchive checks the archive against the ME3 version it was exported
// from, for a restore that runs at that version instead of this repository's.
export async function extractManagedExportEnvelope({
  envelope,
  output,
  passphrase,
  core,
  coreFromArchive = false,
}) {
  requireSecret(passphrase, "Managed export passphrase");
  const destination = resolve(output);
  if (existsSync(destination)) throw new Error("managed export extraction output already exists");
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "me3-managed-extract-"));
  const archivePath = join(temporaryDirectory, "portable.tar.gz");
  const extractionRoot = join(temporaryDirectory, "extracted");
  let copied = false;
  try {
    const verified = await verifyManagedExportEnvelope({
      envelope,
      passphrase,
      decryptedArchiveOutput: archivePath,
    });
    const entries = listTarEntries(archivePath);
    assertOnlyRegularTarEntries(archivePath);
    const roots = new Set();
    for (const entry of entries) {
      const normalized = entry.replace(/\/$/, "");
      if (
        !normalized ||
        normalized.startsWith("/") ||
        normalized.includes("\\") ||
        normalized.split("/").some((part) => !part || part === "." || part === "..")
      ) {
        throw new Error("managed export archive contains an unsafe path");
      }
      roots.add(normalized.split("/")[0]);
    }
    if (roots.size !== 1) throw new Error("managed export archive root is invalid");
    mkdirSync(extractionRoot, { recursive: true });
    runTar(["-xzf", archivePath, "-C", extractionRoot]);
    const portableRoot = join(extractionRoot, [...roots][0]);
    assertRegularTree(portableRoot);
    if (!existsSync(join(portableRoot, "manifest.json"))) {
      throw new Error("managed export portable archive is missing");
    }
    cpSync(portableRoot, destination, { recursive: true, errorOnExist: true, force: false });
    copied = true;
    const portable = validateArchive(destination, passphrase, {
      core: coreFromArchive
        ? JSON.parse(readFileSync(join(destination, "manifest.json"), "utf8")).core
        : core,
    });
    return {
      ok: true,
      format: verified.format,
      installationId: verified.installationId,
      operationId: verified.operationId,
      keyVersion: verified.keyVersion,
      output: destination,
      logicalInstallId: portable.manifest.logicalInstallId,
    };
  } catch (error) {
    if (copied) rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function readEnvelopeHeader(path) {
  const descriptor = openSync(path, "r");
  try {
    const prefix = Buffer.alloc(MAGIC.length + HEADER_LENGTH_BYTES);
    if (readSync(descriptor, prefix, 0, prefix.length, 0) !== prefix.length) {
      throw new Error("managed export envelope is truncated");
    }
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("managed export envelope magic is invalid");
    }
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength < 2 || headerLength > 64 * 1024) {
      throw new Error("managed export envelope header length is invalid");
    }
    const headerBytes = Buffer.alloc(headerLength);
    if (readSync(descriptor, headerBytes, 0, headerLength, prefix.length) !== headerLength) {
      throw new Error("managed export envelope header is truncated");
    }
    return {
      header: JSON.parse(headerBytes.toString("utf8")),
      payloadOffset: prefix.length + headerLength,
    };
  } finally {
    closeSync(descriptor);
  }
}

async function sha256File(path, start = 0) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { start })) hash.update(chunk);
  return hash.digest("hex");
}

function validateIdentity(installationId, operationId) {
  if (!/^mi-[0-9a-f]{16}$/.test(installationId || "")) {
    throw new Error("managed installation id is invalid");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId || "")) {
    throw new Error("managed operation id is invalid");
  }
}

function validateKeyVersion(keyVersion) {
  if (!KEY_VERSION_PATTERN.test(keyVersion || "")) {
    throw new Error("managed export key version is invalid");
  }
}

function requireSecret(value, label) {
  if (typeof value !== "string" || value.length < 32) throw new Error(`${label} is unavailable`);
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error("managed export archive packaging failed");
}

function listTarEntries(path) {
  const result = spawnSync("tar", ["-tzf", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("managed export archive listing failed");
  return result.stdout.split("\n").filter(Boolean);
}

function assertOnlyRegularTarEntries(path) {
  const result = spawnSync("tar", ["-tvzf", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("managed export archive listing failed");
  const lines = result.stdout.split("\n").filter(Boolean);
  if (!lines.length || lines.some((line) => line[0] !== "-" && line[0] !== "d")) {
    throw new Error("managed export archive contains a non-regular entry");
  }
}

function assertRegularTree(root) {
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new Error("managed export archive root is invalid");
  }
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const details = lstatSync(path);
      if (details.isSymbolicLink()) throw new Error("managed export archive contains a symlink");
      if (details.isDirectory()) visit(path);
      else if (!details.isFile()) throw new Error("managed export archive entry is invalid");
    }
  };
  visit(root);
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArgs(values);
  if (command === "extract") {
    console.log(
      JSON.stringify(
        await extractManagedExportEnvelope({
          envelope: required(args, "envelope"),
          output: required(args, "output"),
          passphrase: process.env.ME3_MANAGED_EXPORT_PASSPHRASE,
          coreFromArchive: args["core-from"] === "archive",
        }),
      ),
    );
    return;
  }
  const installationId = required(args, "installation-id");
  const operationId = required(args, "operation-id");
  const keyVersion = required(args, "key-version");
  const passphrase = deriveManagedExportPassphrase(
    resolveManagedExportMasterKey(process.env.ME3_MANAGED_EXPORT_KEYRING, keyVersion),
    installationId,
    operationId,
  );
  if (command === "create") {
    console.log(
      JSON.stringify(
        await createManagedExportEnvelope({
          archive: required(args, "archive"),
          output: required(args, "output"),
          passphrase,
          installationId,
          operationId,
          keyVersion,
        }),
      ),
    );
  } else if (command === "verify") {
    console.log(
      JSON.stringify(
        await verifyManagedExportEnvelope({
          envelope: required(args, "envelope"),
          passphrase,
          expectedInstallationId: installationId,
          expectedOperationId: operationId,
          expectedKeyVersion: keyVersion,
        }),
      ),
    );
  } else {
    throw new Error(
      "usage: managed-export-envelope.mjs <create|verify|extract> [options]; extract uses ME3_MANAGED_EXPORT_PASSPHRASE",
    );
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") || !values[index + 1]) throw new Error("invalid argument");
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}

function required(args, key) {
  if (!args[key]) throw new Error(`--${key} is required`);
  return args[key];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
