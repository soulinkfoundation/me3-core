import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureManagedUpgradeRecovery,
  verifyRecoveryCompatibility
} from './managed-upgrade-recovery.mjs';
const installationId = 'mi-1234567890abcdef';
const workerName = `me3-${installationId}`;
const env = {
  ME3_MANAGED_RECOVERY_PLAN: 'jobs-retirement-212-215-v1',
  ME3_MANAGED_ATTEMPT_ID: '11111111-1111-4111-8111-111111111111',
  ME3_MANAGED_INSTALLATION_ID: installationId,
  ME3_MANAGED_CURRENT_RELEASE_TAG: 'v0.1.212',
  ME3_MANAGED_TARGET_RELEASE_TAG: 'v0.1.215',
  ME3_MANAGED_TARGET_RELEASE_SHA: 'a344d822bc8404adf7ab9ff7bbe4602b55d257ce',
  ME3_MANAGED_CALLBACK_URL: 'https://api.me3.app/api/managed-install/upgrade/callback',
  WORKER_NAME: workerName,
  D1_NAME: `${workerName}-d1`,
  D1_ID: '22222222-2222-4222-8222-222222222222',
  R2_NAME: `${workerName}-r2`,
  QUEUE_NAMES: JSON.stringify([`${workerName}-email`, `${workerName}-jobs`]),
  DO_NAMESPACE_ID: 'b'.repeat(32),
  ME3_MANAGED_ZONE_ID: 'c'.repeat(32),
  PUBLIC_ORIGIN: 'https://owner.me3.app',
  ME3_MANAGED_CANONICAL_HOSTNAME: 'owner.me3.app',
  CLOUDFLARE_API_TOKEN: 'private-token',
  CLOUDFLARE_ACCOUNT_ID: 'd'.repeat(32),
};
const versionId = '33333333-3333-4333-8333-333333333333';
const request = async (url) => Response.json({
  success: true,
  result: url.endsWith('/bookmark') ?
    {
      bookmark: '00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'
    } :
    url.endsWith('/deployments') ? {
      deployments: [{
        versions: [{
          version_id: versionId,
          percentage: 100
        }]
      }]
    } :
    {
      id: versionId
    }
});
const runtime = {
  installationId,
  state: 'quiesced',
  generation: 2,
  activeWrites: 0,
  releaseVersion: '0.1.212',
  credentialsRevokedAt: null,
  storagePurgedAt: null
};
test('captures an exact restore bookmark and immutable prior Worker without owner data', async () => {
  const point = await captureManagedUpgradeRecovery(env, runtime, request);
  assert.equal(point.previousWorkerVersionId, versionId);
  assert.equal(point.resources.d1Id, env.D1_ID);
  assert.equal(point.sourceReleaseTag, 'v0.1.212');
  assert.ok(point.bookmark);
  assert.doesNotMatch(JSON.stringify(point), /private-token/);
});
test('fails before provider access for an unreviewed path or undrained runtime', async () => {
  const noRequest = () => {
    throw Error('unexpected provider access');
  };
  for (const changes of [{
      ME3_MANAGED_RECOVERY_PLAN: 'anything'
    }, {
      ME3_MANAGED_CURRENT_RELEASE_TAG: 'v0.1.211'
    }, {
      ME3_MANAGED_TARGET_RELEASE_SHA: 'a'.repeat(40)
    }]) {
    await assert.rejects(captureManagedUpgradeRecovery({
      ...env,
      ...changes
    }, runtime, noRequest), /recovery plan/);
  }
  for (const changes of [{
      activeWrites: 1
    }, {
      state: 'active'
    }, {
      releaseVersion: '0.1.215'
    }, {
      installationId: 'mi-ffffffffffffffff'
    }]) {
    await assert.rejects(captureManagedUpgradeRecovery(env, {
      ...runtime,
      ...changes
    }, noRequest), /drained/);
  }
});
test('rejects missing Time Travel and ambiguous prior Worker deployment', async () => {
  await assert.rejects(captureManagedUpgradeRecovery(env, runtime, async () => Response.json({
    success: true,
    result: {}
  })), /Worker deployment/);
  await assert.rejects(captureManagedUpgradeRecovery(env, runtime, async url => url.endsWith(
    '/bookmark') ? Response.json({
    success: true,
    result: {}
  }) : request(url)), /bookmark/);
});
test('rejects changed Durable Object code, bindings or migrations in the paired rollback path', () => {
  const previous =
    '[[durable_objects.bindings]]\nname = "ME3_USER_AGENT"\nclass_name = "Me3UserAgent"\n[[migrations]]\ntag = "old"\nnew_sqlite_classes = ["Me3UserAgent"]\n[ai]\nbinding = "AI"\n';
  assert.doesNotThrow(() => verifyRecoveryCompatibility(previous, previous, 'same', 'same'));
  assert.throws(() => verifyRecoveryCompatibility(previous, previous.replace('tag = "old"',
    'tag = "new"'), 'same', 'same'), /Durable Object/);
  assert.throws(() => verifyRecoveryCompatibility(previous, previous, 'old', 'new'), /Durable Object/);
});

test('paired recovery restores the old Worker before D1 and resumes only after the source is verified',
async () => {
    const {
      restoreManagedUpgradeRecovery
    } = await import('./managed-upgrade-recovery.mjs');
    const point = await captureManagedUpgradeRecovery(env, runtime, request);
    const calls = [];
    const recoveryRequest = async (url, options) => {
      calls.push(url);
      return Response.json({
        success: true,
        result: {}
      });
    };
    const control = async (_env, action, tag) => {
      calls.push(`${action}:${tag || ''}`);
      return {
        runtime: {
          ...runtime,
          releaseVersion: tag === 'v0.1.212' ? '0.1.212' : '0.1.215',
          state: action === 'resume' ? 'active' : 'quiesced'
        }
      };
    };
    await restoreManagedUpgradeRecovery(env, point, recoveryRequest, control, async () => ({
      ok: true
    }));
    assert.ok(calls.findIndex(x => x.endsWith('/deployments')) < calls.findIndex(x => x.endsWith(
      '/time_travel/restore')));
    assert.ok(calls.indexOf('status:v0.1.212') < calls.findIndex(x => x.endsWith('/time_travel/restore')));
  assert.equal(calls.at(-1), 'resume:v0.1.212');
    await assert.rejects(restoreManagedUpgradeRecovery(env, {
      ...point,
      resources: {
        ...point.resources,
        d1Id: 'other'
      }
    }, recoveryRequest, control, async () => ({
      ok: true
    })), /recovery point/);
  });