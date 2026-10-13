#!/usr/bin/env node

import {
  readFileSync,
  writeFileSync
} from 'node:fs';
import {
  pathToFileURL
} from 'node:url';
import {
  managedUpgradeContractFromEnv,
  managedUpgradeResourceManifest
} from './managed-upgrade-contract.mjs';
import {
  verifyManagedUpgradeResources
} from './verify-managed-upgrade-resources.mjs';
import {
  callManagedRuntimeControl
} from './managed-runtime-control.mjs';

export const RECOVERY_PLAN_ID = 'jobs-retirement-212-215-v1';
const BROKER_URL = 'https://api.me3.app/api/managed-install/upgrade/control-token';

function recoveryContract(env) {
  const contract = managedUpgradeContractFromEnv(env);
  if (env.ME3_MANAGED_RECOVERY_PLAN !== RECOVERY_PLAN_ID ||
    contract.currentReleaseTag !== 'v0.1.212' || contract.targetReleaseTag !== 'v0.1.215' ||
    contract.targetReleaseSha !== 'a344d822bc8404adf7ab9ff7bbe4602b55d257ce') {
    throw Error('managed upgrade recovery plan does not match the exact release path');
  }
  return contract;
}

export function verifyRecoveryCompatibility(previousConfig, targetConfig, previousAgent, targetAgent) {
  const sections = config => Array.from(config.matchAll(
    /\[\[(?:durable_objects\.bindings|migrations)\]\][\s\S]*?(?=\n\[|$)/g), match => match[0].trim());
  if (previousAgent !== targetAgent || JSON.stringify(sections(previousConfig)) !== JSON.stringify(sections(
      targetConfig)) || sections(previousConfig).length !== 2) {
    throw Error('paired recovery requires unchanged Durable Object code, bindings and migrations');
  }
}

export async function captureManagedUpgradeRecovery(env, runtime, request = globalThis.fetch) {
  const contract = recoveryContract(env);
  if (runtime?.installationId !== contract.installationId || runtime.state !== 'quiesced' ||
    runtime.activeWrites !== 0 || runtime.releaseVersion !== '0.1.212' ||
    !Number.isSafeInteger(runtime.generation) || runtime.generation < 1 ||
    runtime.credentialsRevokedAt !== null || runtime.storagePurgedAt !== null) {
    throw Error('managed runtime must be quiesced and drained before recovery capture');
  }
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[0-9a-f]{32}$/.test(account || '') || !env.CLOUDFLARE_API_TOKEN) throw Error(
    'recovery provider configuration is invalid');
  const api = async path => {
    const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`
      },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true) throw Error('managed recovery provider lookup failed');
    return body.result;
  };
  const deployments = await api(`workers/scripts/${contract.workerName}/deployments`);
  const versions = deployments?.deployments?.[0]?.versions;
  if (!Array.isArray(versions) || versions.length !== 1 || versions[0].percentage !== 100 ||
    !/^[0-9a-f-]{36}$/.test(versions[0].version_id || '')) throw Error(
    'previous Worker deployment is ambiguous');
  const versionId = versions[0].version_id;
  const previous = await api(`workers/scripts/${contract.workerName}/versions/${versionId}`);
  if (previous?.id !== versionId) throw Error('previous immutable Worker version is unavailable');
  const point = await api(`d1/database/${contract.d1Id}/time_travel/bookmark`);
  if (typeof point?.bookmark !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/.test(
      point.bookmark)) throw Error('fresh D1 recovery bookmark is unavailable');
  return {
    planId: RECOVERY_PLAN_ID,
    attemptId: contract.attemptId,
    installationId: contract.installationId,
    sourceReleaseTag: contract.currentReleaseTag,
    targetReleaseTag: contract.targetReleaseTag,
    targetCommitSha: contract.targetReleaseSha,
    capturedAt: new Date().toISOString(),
    generation: runtime.generation,
    bookmark: point.bookmark,
    previousWorkerVersionId: versionId,
    resources: managedUpgradeResourceManifest(contract),
  };
}

export async function restoreManagedUpgradeRecovery(env, point, request = globalThis.fetch, runtimeControl =
  control, verifyResources = verifyManagedUpgradeResources) {
  const contract = recoveryContract(env);
  const age = Date.now() - Date.parse(point?.capturedAt);
  if (point?.planId !== RECOVERY_PLAN_ID || point.attemptId !== contract.attemptId ||
    point.installationId !== contract.installationId || point.sourceReleaseTag !== contract
    .currentReleaseTag ||
    point.targetReleaseTag !== contract.targetReleaseTag || point.targetCommitSha !== contract
    .targetReleaseSha ||
    JSON.stringify(point.resources) !== JSON.stringify(managedUpgradeResourceManifest(contract)) ||
    !Number.isFinite(age) || age < 0 || age > 7 * 24 * 60 * 60_000 ||
    !/^[0-9a-f-]{36}$/.test(point.previousWorkerVersionId || '') ||
    !/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/.test(point.bookmark || '') ||
    !/^[0-9a-f]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID || '') || !env.CLOUDFLARE_API_TOKEN) {
    throw Error('paired recovery point does not match the frozen installation or recovery window');
  }
  const before = await runtimeControl(env, 'status');
  if (before.runtime.state !== 'quiesced' || before.runtime.activeWrites !== 0 ||
    before.runtime.installationId !== contract.installationId ||
    !['0.1.212', '0.1.215'].includes(before.runtime.releaseVersion)) throw Error(
    'paired recovery requires paused, drained writes');
  const mutate = async (path, body) => {
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.success !== true) throw Error(
      'paired recovery stopped; keep writes paused for operator review');
  };
  // Restore old code first so the target cannot reapply the destructive migration.
  await mutate(`workers/scripts/${contract.workerName}/deployments`, {
    strategy: 'percentage',
    versions: [{
      version_id: point.previousWorkerVersionId,
      percentage: 100
    }]
  });
  let sourceReady = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const source = await runtimeControl(env, 'status', 'v0.1.212');
      sourceReady = source.runtime.state === 'quiesced' && source.runtime.activeWrites === 0 &&
        source.runtime.releaseVersion === '0.1.212';
    } catch { /* The previous Worker may still be propagating. */ }
    if (sourceReady) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  if (!sourceReady) throw Error('previous Worker is not live; database restore was not started');
  await mutate(`d1/database/${contract.d1Id}/time_travel/restore`, {
    bookmark: point.bookmark
  });
  await verifyResources({
    ...contract,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    releaseTag: contract.currentReleaseTag
  }, request);
  const restored = await runtimeControl(env, 'status', 'v0.1.212');
  if (restored.runtime.state !== 'quiesced' || restored.runtime.activeWrites !== 0 ||
    restored.runtime.releaseVersion !== '0.1.212') throw Error(
    'paired source recovery is unverified; keep writes paused');
  const resumed = await runtimeControl(env, 'resume', 'v0.1.212');
  if (resumed.runtime.state !== 'active') throw Error('recovered source did not resume');
}

async function control(env, action, expectedReleaseTag) {
  const contract = recoveryContract(env);
  return callManagedRuntimeControl({
    installationId: contract.installationId,
    operationId: contract.attemptId,
    attemptId: contract.attemptId,
    action,
    callbackSecret: env.ME3_MANAGED_UPGRADE_CALLBACK_SECRET,
    expectedReleaseTag,
    brokerUrl: BROKER_URL
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  const env = process.env;
  if (action === 'compatibility') {
    recoveryContract(env);
    verifyRecoveryCompatibility(readFileSync('previous/wrangler.toml', 'utf8'), readFileSync(
        'source/wrangler.toml', 'utf8'),
      readFileSync('previous/apps/worker/src/user-agent.ts', 'utf8'), readFileSync(
        'source/apps/worker/src/user-agent.ts', 'utf8'));
  } else if (action === 'capture') {
    await control(env, 'quiesce', 'v0.1.212');
    let status;
    for (let attempt = 0; attempt < 30; attempt++) {
      status = await control(env, 'status', 'v0.1.212');
      if (status.runtime.state === 'quiesced' && status.runtime.activeWrites === 0) break;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    const point = await captureManagedUpgradeRecovery(env, status.runtime);
    writeFileSync(env.ME3_MANAGED_RECOVERY_FILE, JSON.stringify(point, null, 2) + '\n', {
      mode: 0o600
    });
    const recorded = await fetch('https://api.me3.app/api/managed-install/upgrade/recovery', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ME3_MANAGED_UPGRADE_CALLBACK_SECRET}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(point),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!recorded.ok || (await recorded.json()).ok !== true) throw Error(
      'private recovery point was not recorded; keep writes paused');
  } else if (action === 'restore') {
    const point = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    await restoreManagedUpgradeRecovery(env, point);
  } else if (action === 'resume') {
    const result = await control(env, 'resume', 'v0.1.215');
    if (result.runtime.state !== 'active') throw Error('target runtime did not resume');
  } else throw Error('unknown managed recovery action');
}