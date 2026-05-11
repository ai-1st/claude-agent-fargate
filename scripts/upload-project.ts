#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    dir: { type: "string" },
    description: { type: "string" },
    "system-prompt": { type: "string" },
    "system-prompt-file": { type: "string" },
    tools: { type: "string" },
    "heartbeat-cron": { type: "string" },
    "memory-enabled": { type: "string", default: "true" },
    "mcp-enabled": { type: "string", default: "false" },
    profile: { type: "string", default: "co" },
    stack: { type: "string", default: "claude-agent-serverless" },
    region: { type: "string", default: "us-east-1" },
  },
});

if (!values.name || !values.dir) {
  console.error(
    "Usage: npx tsx scripts/upload-project.ts --name <name> --dir <path>\n" +
      "  [--description <text>]\n" +
      "  [--system-prompt <text> | --system-prompt-file <path>]\n" +
      "  [--tools Read,Bash,WebSearch] [--heartbeat-cron 'rate(30 minutes)']\n" +
      "  [--memory-enabled true|false] [--mcp-enabled true|false]\n" +
      "  [--profile ce]"
  );
  process.exit(1);
}

const { name, dir, profile, stack, region } = values;

function aws(cmd: string): string {
  return execSync(`aws ${cmd} --profile ${profile} --region ${region}`, { encoding: "utf-8" }).trim();
}

const outputsJson = aws(
  `cloudformation describe-stacks --stack-name ${stack} --query "Stacks[0].Outputs"`
);
const outputs: Array<{ OutputKey: string; OutputValue: string }> = JSON.parse(outputsJson);
const getOutput = (key: string) => outputs.find((o) => o.OutputKey === key)?.OutputValue;

const bucket = getOutput("BucketName");
const table = getOutput("TableName");
if (!bucket || !table) {
  console.error("Could not find BucketName or TableName in stack outputs");
  process.exit(1);
}

let personaJsonDescription: string | undefined;
let personaJsonActions: string[] | undefined;
const personaJsonPath = join(dir, "persona.json");
if (existsSync(personaJsonPath)) {
  try {
    const parsed = JSON.parse(readFileSync(personaJsonPath, "utf-8")) as {
      description?: string;
      actions?: string[];
    };
    personaJsonDescription = parsed.description;
    personaJsonActions = parsed.actions;
  } catch (e) {
    console.warn(`Warning: failed to parse persona.json: ${(e as Error).message}`);
  }
}

const description = values.description ?? personaJsonDescription;
const actions = personaJsonActions;

const BUCKET_PREFIX = "lambda/";
const s3Prefix = `${BUCKET_PREFIX}personas/${name}/`;
console.log(`Syncing ${dir} → s3://${bucket}/${s3Prefix} (excluding memory/, .env, .git)`);
aws(
  `s3 sync ${dir} s3://${bucket}/${s3Prefix} --delete ` +
    `--exclude "memory/*" --exclude ".env" --exclude ".git/*" --exclude ".DS_Store"`
);

let systemPrompt: string | undefined;
if (values["system-prompt-file"]) {
  if (!existsSync(values["system-prompt-file"])) {
    console.error(`System prompt file not found: ${values["system-prompt-file"]}`);
    process.exit(1);
  }
  systemPrompt = readFileSync(values["system-prompt-file"], "utf-8");
} else if (values["system-prompt"]) {
  systemPrompt = values["system-prompt"];
}

const tools = values.tools
  ? values.tools.split(",").map((s) => s.trim()).filter(Boolean)
  : undefined;

const now = new Date().toISOString();
const item: Record<string, { S?: string; BOOL?: boolean; SS?: string[] }> = {
  pk: { S: `PERSONA#${name}` },
  sk: { S: "META" },
  name: { S: name },
  s3Key: { S: s3Prefix },
  memoryEnabled: { BOOL: values["memory-enabled"] !== "false" },
  mcpEnabled: { BOOL: values["mcp-enabled"] === "true" },
  createdAt: { S: now },
  updatedAt: { S: now },
};
if (description) item.description = { S: description };
if (actions && actions.length) item.actions = { SS: actions };
if (systemPrompt) item.systemPrompt = { S: systemPrompt };
if (tools && tools.length) item.allowedTools = { SS: tools };
if (values["heartbeat-cron"]) item.heartbeatCron = { S: values["heartbeat-cron"] };

console.log(`Registering persona in DynamoDB: ${table}`);
const itemJson = JSON.stringify(item);
aws(`dynamodb put-item --table-name ${table} --item '${itemJson.replace(/'/g, "'\\''")}'`);

console.log(`Done. Persona "${name}" uploaded and registered.`);
console.log(`Worker Lambda will see it at /mnt/s3/personas/${name}/ (eventually consistent — first read may be slow).`);
if (values["heartbeat-cron"]) {
  console.log(`Heartbeat cron set to "${values["heartbeat-cron"]}". To wire up the EventBridge Scheduler,`);
  console.log(`open the persona in the web UI and click Save (POST /personas).`);
}
