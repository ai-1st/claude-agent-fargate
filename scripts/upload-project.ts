#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    dir: { type: "string" },
    profile: { type: "string", default: "co" },
    stack: { type: "string", default: "claude-agent-fargate" },
    region: { type: "string", default: "us-east-1" },
  },
});

if (!values.name || !values.dir) {
  console.error("Usage: npx tsx scripts/upload-project.ts --name <name> --dir <path> [--profile ce]");
  process.exit(1);
}

const { name, dir, profile, stack, region } = values;

function aws(cmd: string): string {
  return execSync(`aws ${cmd} --profile ${profile} --region ${region}`, {
    encoding: "utf-8",
  }).trim();
}

// Get stack outputs
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

// Tar the project directory
const tgzPath = `/tmp/${name}.tgz`;
console.log(`Archiving ${dir} → ${tgzPath}`);
execSync(`tar czf ${tgzPath} -C ${dir} .`, { stdio: "inherit" });

// Upload to S3
const s3Key = `projects/${name}/project.tgz`;
console.log(`Uploading to s3://${bucket}/${s3Key}`);
aws(`s3 cp ${tgzPath} s3://${bucket}/${s3Key}`);

// Register in DynamoDB
const now = new Date().toISOString();
const item = JSON.stringify({
  pk: { S: `PROJECT#${name}` },
  sk: { S: "PROJECT" },
  name: { S: name },
  s3Key: { S: s3Key },
  createdAt: { S: now },
  updatedAt: { S: now },
});
console.log(`Registering project in DynamoDB: ${table}`);
aws(
  `dynamodb put-item --table-name ${table} --item '${item.replace(/'/g, "'\\''")}'`
);

console.log(`Done. Project "${name}" uploaded and registered.`);
