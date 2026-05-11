#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";

const { values } = parseArgs({
  options: {
    persona: { type: "string" },
    dir: { type: "string" },
    direction: { type: "string", default: "pull" }, // pull | push
    profile: { type: "string", default: "co" },
    stack: { type: "string", default: "claude-agent-serverless" },
    region: { type: "string", default: "us-east-1" },
  },
});

if (!values.persona || !values.dir) {
  console.error(
    "Usage: npx tsx scripts/memory-sync.ts --persona <name> --dir <local-dir> [--direction pull|push]"
  );
  process.exit(1);
}

const { persona, dir, direction, profile, stack, region } = values;

function aws(cmd: string): string {
  return execSync(`aws ${cmd} --profile ${profile} --region ${region}`, { encoding: "utf-8" }).trim();
}

const outputs: Array<{ OutputKey: string; OutputValue: string }> = JSON.parse(
  aws(`cloudformation describe-stacks --stack-name ${stack} --query "Stacks[0].Outputs"`)
);
const bucket = outputs.find((o) => o.OutputKey === "BucketName")?.OutputValue;
if (!bucket) {
  console.error("BucketName not found in stack outputs");
  process.exit(1);
}

const BUCKET_PREFIX = "lambda/";
const s3Prefix = `s3://${bucket}/${BUCKET_PREFIX}memory/${persona}/`;
mkdirSync(dir, { recursive: true });

if (direction === "pull") {
  console.log(`Pulling ${s3Prefix} → ${dir}/`);
  execSync(
    `aws s3 sync "${s3Prefix}" "${dir}/" --profile ${profile} --region ${region} --delete`,
    { stdio: "inherit" }
  );
} else if (direction === "push") {
  console.log(`Pushing ${dir}/ → ${s3Prefix}`);
  console.warn("WARN: --direction push bypasses the worker's DDB index; the worker will rebuild it on next run.");
  execSync(
    `aws s3 sync "${dir}/" "${s3Prefix}" --profile ${profile} --region ${region} --delete`,
    { stdio: "inherit" }
  );
} else {
  console.error(`Unknown direction: ${direction}`);
  process.exit(1);
}
console.log("Done.");
