import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./configure-managed-install.mjs", import.meta.url);

test("configures a private managed Worker without raw model selection", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-managed-config-"));
  const configPath = join(directory, "wrangler.toml");
  writeFileSync(
    configPath,
    [
      'name = "my-me3"',
      "",
      "[vars]",
      'ME3_DEPLOYMENT_MODE = "self_hosted"',
      'ME3_AI_IMAGE_GENERATION_PROVIDER = "workers-ai"',
      'ME3_AI_IMAGE_GENERATION_MODEL = "@cf/black-forest-labs/flux-2-klein-4b"',
      "",
    ].join("\n"),
  );

  try {
    execFileSync(process.execPath, [
      script.pathname,
      configPath,
      "me3-mi-1234567890abcdef",
      "false",
      "mi-1234567890abcdef",
      "https://api.me3.app",
      "https://owner.me3.app",
    ]);
    const output = readFileSync(configPath, "utf8");
    assert.match(output, /^name = "me3-mi-1234567890abcdef"$/m);
    assert.match(output, /^workers_dev = false$/m);
    assert.match(output, /^ME3_DEPLOYMENT_MODE = "managed"$/m);
    assert.match(output, /^ME3_MANAGED_INSTALLATION_ID = "mi-1234567890abcdef"$/m);
    assert.match(output, /^ME3_MANAGED_EMAIL_GATEWAY_ORIGIN = "https:\/\/api\.me3\.app"$/m);
    assert.match(output, /^ME3_SOCIAL_OAUTH_ORIGIN = "https:\/\/api\.me3\.app"$/m);
    assert.match(output, /^CORE_WEB_ORIGIN = "https:\/\/owner\.me3\.app"$/m);
    assert.match(output, /^CORE_API_ORIGIN = "https:\/\/owner\.me3\.app"$/m);
    assert.match(output, /^ME3_AI_CHAT_PROVIDER = "workers-ai"$/m);
    assert.match(output, /^ME3_AI_CHAT_MODEL = "openai\/gpt-6.1-sol"$/m);
    assert.doesNotMatch(output, /ME3_AGENT_ROUTING/);
    assert.match(output, /^ME3_AGENT_FAST_MODEL = "anthropic\/claude-haiku-5.5"$/m);
    assert.match(output, /^ME3_WEB_SEARCH_MODEL = "openai\/gpt-5.4-mini"$/m);
    assert.doesNotMatch(output, /ME3_AI_IMAGE_GENERATION_PROVIDER/);
    assert.doesNotMatch(output, /ME3_AI_IMAGE_GENERATION_MODEL/);
    assert.doesNotMatch(output, /ME3_AI_RAW_MODEL_SELECTION_ENABLED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses raw model selection in a managed config", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-managed-config-"));
  const configPath = join(directory, "wrangler.toml");
  writeFileSync(
    configPath,
    'name = "my-me3"\n[vars]\nME3_DEPLOYMENT_MODE = "self_hosted"\nME3_AI_RAW_MODEL_SELECTION_ENABLED = "true"\n',
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        script.pathname,
        configPath,
        "me3-mi-1234567890abcdef",
        "true",
        "mi-1234567890abcdef",
        "https://api.me3.app",
        "https://owner.me3.app",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /raw model selection must be absent/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses Worker routes and custom domains in a managed config", async (t) => {
  const declarations = [
    'route = "example.com/*"',
    'routes = [{ pattern = "example.com/*", custom_domain = true }]',
    '[[routes]]\npattern = "example.com/*"',
    '[[env.production.routes]]\npattern = "example.com/*"',
    '[vars]\ncustom_domain = "example.com"',
  ];

  for (const declaration of declarations) {
    await t.test(declaration.split("\n")[0], () => {
      const directory = mkdtempSync(join(tmpdir(), "me3-managed-config-"));
      const configPath = join(directory, "wrangler.toml");
      writeFileSync(
        configPath,
        [
          'name = "my-me3"',
          declaration,
          "[vars]",
          'ME3_DEPLOYMENT_MODE = "self_hosted"',
          "",
        ].join("\n"),
      );

      try {
        const result = spawnSync(
          process.execPath,
          [
            script.pathname,
            configPath,
            "me3-mi-1234567890abcdef",
            "false",
            "mi-1234567890abcdef",
            "https://api.me3.app",
            "https://owner.me3.app",
          ],
          { encoding: "utf8" },
        );
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /must not declare routes or custom domains/);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("refuses a non-HTTPS managed email gateway origin", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-managed-config-"));
  const configPath = join(directory, "wrangler.toml");
  writeFileSync(
    configPath,
    'name = "my-me3"\n[vars]\nME3_DEPLOYMENT_MODE = "self_hosted"\n',
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        script.pathname,
        configPath,
        "me3-mi-1234567890abcdef",
        "true",
        "mi-1234567890abcdef",
        "http://api.me3.app",
        "https://owner.me3.app",
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /explicit HTTPS origin/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("isolates every managed queue and dead-letter queue by Worker", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-managed-config-"));
  const configPath = join(directory, "wrangler.toml");
  writeFileSync(
    configPath,
    [
      'name = "my-me3"',
      "[vars]",
      'ME3_DEPLOYMENT_MODE = "self_hosted"',
      "[[queues.producers]]",
      'binding = "SOCIAL_PUBLISH_QUEUE"',
      'queue = "me3-social-publish"',
      "[[queues.consumers]]",
      'queue = "me3-social-publish"',
      'dead_letter_queue = "me3-social-publish-dlq"',
      "[[queues.consumers]]",
      'queue = "me3-social-publish-dlq"',
      "",
    ].join("\n"),
  );

  try {
    execFileSync(process.execPath, [
      script.pathname,
      configPath,
      "me3-mi-1234567890abcdef",
      "true",
      "mi-1234567890abcdef",
      "https://api.me3.app",
      "https://owner.me3.app",
    ]);
    const output = readFileSync(configPath, "utf8");
    const queueAssignments = output.match(/^\s*(?:queue|dead_letter_queue)\s*=\s*"[^"]+"$/gm) || [];
    assert.equal(queueAssignments.length, 4);
    for (const assignment of queueAssignments) {
      assert.match(assignment, /"me3-mi-1234567890abcdef-social-publish(?:-dlq)?"$/);
    }
    assert.doesNotMatch(output, /"me3-social-publish(?:-dlq)?"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
