#!/usr/bin/env node

import {
  PortableError,
  comparePortableArchives,
  exportPortableV1,
  resolveCoreInfo,
  restorePortableV1,
  validateArchive,
} from "./portable-v1.mjs";
import { runLocalProof } from "./portable-proof.mjs";

const [command, ...argv] = process.argv.slice(2);
const args = parseArgs(argv);

try {
  if (command === "export") {
    const result = await exportPortableV1({
      database: required(args, "db"),
      r2Directory: args["r2-dir"],
      output: required(args, "output"),
      installId: args["install-id"],
      passphrase: process.env.ME3_PORTABLE_PASSPHRASE,
      managedHosted: Boolean(args["managed-hosted"]),
      core: coreFromArgs(args),
    });
    console.log(JSON.stringify({ ok: true, archive: result.archive, manifest: result.manifest }, null, 2));
  } else if (command === "restore") {
    const result = restorePortableV1({
      archive: required(args, "archive"),
      targetDatabase: required(args, "target-db"),
      targetR2Directory: required(args, "target-r2-dir"),
      importSqlOutput: args["sql-output"],
      passphrase: process.env.ME3_PORTABLE_PASSPHRASE,
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "verify") {
    const result = validateArchive(required(args, "archive"), process.env.ME3_PORTABLE_PASSPHRASE, {
      core: coreFromArgs(args),
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          format: result.manifest.format,
          logicalInstallId: result.manifest.logicalInstallId,
          databaseRows: result.manifest.database.portableRowCount,
          r2Objects: result.manifest.objects.count,
        },
        null,
        2,
      ),
    );
  } else if (command === "compare") {
    console.log(
      JSON.stringify(
        comparePortableArchives({
          sourceArchive: required(args, "source"),
          restoredArchive: required(args, "restored"),
          passphrase: process.env.ME3_PORTABLE_PASSPHRASE,
        }),
        null,
        2,
      ),
    );
  } else if (command === "proof") {
    const proof = await runLocalProof({ keep: Boolean(args.keep) });
    console.log(
      JSON.stringify(
        {
          ok: proof.ok,
          format: proof.format,
          logicalInstallId: proof.logicalInstallId,
          core: proof.core,
          databaseRows: proof.databaseRows,
          r2Objects: proof.r2Objects,
          sessionsRotated: proof.sessionsRotated,
          oldDeviceCredentialsRemoved: proof.oldDeviceCredentialsRemoved,
          oldBrowserSessionRejected: proof.oldBrowserSessionRejected,
          oldDeviceAccessRejected: proof.oldDeviceAccessRejected,
          oldDeviceRefreshRejected: proof.oldDeviceRefreshRejected,
          clientRepairedWithFreshCredential: proof.clientRepairedWithFreshCredential,
          archive: proof.archive,
        },
        null,
        2,
      ),
    );
  } else {
    usage();
    process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  const portable = error instanceof PortableError;
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: portable ? error.code : "UNEXPECTED_ERROR",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

// --core-root names the checkout of the ME3 release the data came from, when
// these scripts run from a different checkout (the hosted lifecycle controls).
function coreFromArgs(args) {
  return args["core-root"] ? resolveCoreInfo(args["core-root"]) : undefined;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) throw new PortableError("INVALID_ARGUMENT", `Unexpected argument: ${value}`);
    const key = value.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || !value) {
    throw new PortableError("INVALID_ARGUMENT", `--${key} is required`);
  }
  return value;
}

function usage() {
  console.log(`ME3 portable-v1 snapshot and clean restore

Set ME3_PORTABLE_PASSPHRASE to a strong owner-only passphrase.

  pnpm portable:export -- --db <source.sqlite> [--r2-dir <materialized-r2>] --output <archive-dir> [--managed-hosted]
  pnpm portable:restore -- --archive <archive-dir> --target-db <clean.sqlite> --target-r2-dir <empty-dir> [--sql-output <sensitive-import.sql>]
  pnpm portable:verify -- --archive <archive-dir>
  pnpm portable:compare -- --source <source-archive> --restored <restored-archive>
  pnpm portable:proof [-- --keep]

The source D1/R2 material must be captured during an explicit quiescent window. Live transfer,
Cloudflare provisioning, write barriers, billing, and deployment cutover are intentionally absent.`);
}
