#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const { values } = parseArgs({
  options: {
    dir: { type: "string", default: "./projects" },
    profile: { type: "string", default: "co" },
    stack: { type: "string", default: "claude-agent-serverless" },
    region: { type: "string", default: "us-east-1" },
    only: { type: "string" },
  },
});

const { dir, profile, stack, region } = values;

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

if (!existsSync(dir)) {
  console.error(`Templates source dir not found: ${dir}`);
  process.exit(1);
}

const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : undefined;

const children = readdirSync(dir).filter((n) => {
  const p = join(dir, n);
  if (!statSync(p).isDirectory()) return false;
  return existsSync(join(p, "CLAUDE.md")) || existsSync(join(p, "persona.json"));
});

if (!children.length) {
  console.log(`No template candidates in ${dir}. A template dir needs CLAUDE.md and/or persona.json.`);
  process.exit(0);
}

const BUCKET_PREFIX = "lambda/";
console.log(`Syncing ${children.length} template(s) from ${dir} → s3://${bucket}/${BUCKET_PREFIX}templates/`);

function* walk(root: string, sub: string): Generator<string> {
  const here = join(root, sub);
  for (const entry of readdirSync(here, { withFileTypes: true })) {
    const child = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.name === ".git" || entry.name === "memory" || entry.name === ".DS_Store") continue;
    if (entry.isDirectory()) yield* walk(root, child);
    else if (entry.isFile()) yield child;
  }
}

function dirSha(rootDir: string): string {
  const h = createHash("sha256");
  const files = [...walk(rootDir, "")].sort();
  for (const rel of files) {
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(join(rootDir, rel)));
    h.update("\0");
  }
  return h.digest("hex");
}

for (const name of children) {
  if (only && !only.has(name)) continue;
  const projectDir = join(dir, name);

  let description: string | undefined;
  let actions: string[] | undefined;
  const personaJsonPath = join(projectDir, "persona.json");
  if (existsSync(personaJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(personaJsonPath, "utf-8")) as {
        description?: string;
        actions?: string[];
      };
      description = parsed.description;
      actions = parsed.actions;
    } catch (e) {
      console.warn(`  ! ${name}: bad persona.json: ${(e as Error).message}`);
    }
  }

  const sha = dirSha(projectDir);
  const prefix = `${BUCKET_PREFIX}templates/${name}/`;
  aws(
    `s3 sync ${projectDir} s3://${bucket}/${prefix} --delete ` +
      `--exclude "memory/*" --exclude ".env" --exclude ".git/*" --exclude ".DS_Store"`
  );

  const now = new Date().toISOString();
  const item: Record<string, { S?: string; SS?: string[] }> = {
    pk: { S: `TEMPLATE#${name}` },
    sk: { S: "META" },
    name: { S: name },
    s3Key: { S: prefix },
    sha256: { S: sha },
    createdAt: { S: now },
    updatedAt: { S: now },
  };
  if (description) item.description = { S: description };
  if (actions && actions.length) item.actions = { SS: actions };

  aws(
    `dynamodb put-item --table-name ${table} --item '${JSON.stringify(item).replace(/'/g, "'\\''")}'`
  );

  console.log(`  ✓ ${name} (sha=${sha.slice(0, 12)})`);
}

console.log("Done.");
