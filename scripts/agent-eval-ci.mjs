import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createAgentEvalCorpus, completeCorpusContract } from "./agent-eval-corpus.mjs";
import { sourceFingerprint } from "./agent-eval-source.mjs";

const SAFETY = ["duplicateWrites", "unauthorizedWrites", "wrongRecordWrites"];

export function validateScriptedCiReport(report) {
  const errors = []; const quarantined = [];
  let ids;
  try { ids = createAgentEvalCorpus(report.baseDate, report.supplement || "").scenarios.map(item => item.id); }
  catch { return { passed: false, quarantined, errors: ["Invalid scenario seed date"] }; }
  const rows = report.results || [];
  if (report.runtime !== "new" || report.live !== false || !Number.isInteger(report.repeat) || report.repeat < 1) errors.push("CI requires the new scripted runtime");
  if (report.scenarioCount !== ids.length || report.totalScenarioCount !== ids.length || rows.length !== ids.length * report.repeat || !report.gate?.checks?.complete || !report.gate?.checks?.fullSuite) errors.push("Incomplete full-suite evidence");
  if (!completeCorpusContract(report, [...new Set(rows.map(row => row.id))]) || report.supplement && !report.gate?.checks?.quoteGuards) errors.push("Incomplete supplemental guard contract");
  if (report.sourceChangedDuringRun || !report.gate?.checks?.sourceStable || report.sourceFingerprint !== sourceFingerprint()) errors.push("Source changed or report is stale");
  if (report.totals?.providerFailures !== 0 || !SAFETY.every(name => report.totals?.safety?.[name] === 0)) errors.push("Unsafe writes or provider failures");
  for (const id of ids) {
    const repeats = rows.filter(row => row.id === id).map(row => row.repeat);
    if (repeats.length !== report.repeat || new Set(repeats).size !== report.repeat || repeats.some(value => !Number.isInteger(value) || value < 1 || value > report.repeat)) errors.push(`Missing or duplicate repeat: ${id}`);
  }
  for (const row of rows) {
    if (!ids.includes(row.id) || row.error || row.providerFailure !== false || !SAFETY.every(name => row.safety?.[name] === 0) || row.persistedVerification?.freshConnection !== true || !(row.persistedVerification.reopenCount >= row.turns?.length)) { errors.push(`Invalid or unsafe row: ${row.id}`); continue; }
    if (row.passed === true && row.stateCheckPassed === true) continue;
    errors.push(`Failed scenario: ${row.id}`);
  }
  return { passed: errors.length === 0, quarantined, errors };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  for (const arg of args) if (!/^--(?:repeat|date|report|supplement)=.+$/.test(arg)) throw new Error(`Unknown scripted CI option: ${arg}`);
  const value = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const reportPath = resolve(value("report", "new-agent-eval.json"));
  const command = ["eval:agent", "--", "--runtime=new", "--model=scripted-fixture", `--repeat=${value("repeat", "1")}`, `--report=${reportPath}`];
  const date = value("date", null); if (date) command.push(`--date=${date}`);
  const supplement = value("supplement", null); if (supplement) command.push(`--supplement=${supplement}`);
  const run = spawnSync("pnpm", command, { stdio: "inherit" });
  try {
    if (![0, 1].includes(run.status)) throw new Error(`Scripted runner did not complete normally (${run.status})`);
    const result = validateScriptedCiReport(JSON.parse(readFileSync(reportPath, "utf8")));
    if (!result.passed) throw new Error(result.errors.join("\n"));
    console.log("Full scripted suite complete; every outcome passed and every safety check is zero.");
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
