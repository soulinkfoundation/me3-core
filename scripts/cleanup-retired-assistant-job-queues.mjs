#!/usr/bin/env node

import { deleteRetiredAssistantJobQueues } from "./decommission-managed-install.mjs";

const args = {};
for (let index = 2; index < process.argv.length; index += 2) {
  if (!["--worker-name", "--release-tag"].includes(process.argv[index]) || !process.argv[index + 1]) {
    throw new Error("usage: cleanup-retired-assistant-job-queues.mjs --worker-name <managed-worker> --release-tag <stable-tag>");
  }
  args[process.argv[index].slice(2)] = process.argv[index + 1];
}
console.log(JSON.stringify(await deleteRetiredAssistantJobQueues({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken: process.env.CLOUDFLARE_API_TOKEN,
  workerName: args["worker-name"],
  releaseTag: args["release-tag"],
})));
