#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    project: { type: "string" },
    key: { type: "string" },
    value: { type: "string" },
    list: { type: "boolean", default: false },
    delete: { type: "boolean", default: false },
    profile: { type: "string", default: "co" },
    region: { type: "string", default: "us-east-1" },
  },
});

if (!values.project) {
  console.error(
    "Usage:\n" +
    "  npx tsx scripts/set-secret.ts --project <name> --key <KEY> --value <val> [--profile ce]\n" +
    "  npx tsx scripts/set-secret.ts --project <name> --list [--profile ce]\n" +
    "  npx tsx scripts/set-secret.ts --project <name> --key <KEY> --delete [--profile ce]"
  );
  process.exit(1);
}

const { project, profile, region } = values;
const prefix = `/claude-agent/projects/${project}/`;

function aws(cmd: string): string {
  return execSync(`aws ${cmd} --profile ${profile} --region ${region}`, {
    encoding: "utf-8",
  }).trim();
}

if (values.list) {
  // List secrets (names only)
  try {
    const result = aws(
      `ssm get-parameters-by-path --path "${prefix}" --query "Parameters[].Name" --output json`
    );
    const names: string[] = JSON.parse(result);
    if (names.length === 0) {
      console.log(`No secrets for project "${project}"`);
    } else {
      console.log(`Secrets for project "${project}":`);
      for (const n of names) {
        console.log(`  ${n.split("/").pop()}`);
      }
    }
  } catch {
    console.log(`No secrets for project "${project}"`);
  }
} else if (values.delete) {
  if (!values.key) {
    console.error("--key is required for --delete");
    process.exit(1);
  }
  const paramName = `${prefix}${values.key}`;
  console.log(`Deleting ${paramName}`);
  aws(`ssm delete-parameter --name "${paramName}"`);
  console.log("Deleted.");
} else {
  if (!values.key || values.value === undefined) {
    console.error("--key and --value are required");
    process.exit(1);
  }
  const paramName = `${prefix}${values.key}`;
  console.log(`Setting ${paramName}`);
  aws(
    `ssm put-parameter --name "${paramName}" --type SecureString --value "${values.value}" --overwrite`
  );
  console.log("Done.");
}
