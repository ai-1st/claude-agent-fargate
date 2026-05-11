#!/usr/bin/env npx tsx
import { execSync } from "node:child_process";
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, cpSync, statSync } from "node:fs";
import { join } from "node:path";

const { values } = parseArgs({
  options: {
    persona: { type: "string" },
    "skill-dir": { type: "string" },
    "project-dir": { type: "string" },
    profile: { type: "string", default: "co" },
    stack: { type: "string", default: "claude-agent-serverless" },
    region: { type: "string", default: "us-east-1" },
  },
});

if (!values.persona || !values["skill-dir"] || !values["project-dir"]) {
  console.error(
    "Usage: npx tsx scripts/skill-add.ts \\\n" +
      "  --persona <name> --skill-dir <local-skill-dir> --project-dir <local-project-dir>\n\n" +
      "Copies <skill-dir> into <project-dir>/skills/<basename>, then re-uploads project."
  );
  process.exit(1);
}

const { persona, profile, stack, region } = values;
const skillDir = values["skill-dir"]!;
const projectDir = values["project-dir"]!;

if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
  console.error(`Skill dir not found or not a directory: ${skillDir}`);
  process.exit(1);
}
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
  console.error(`Project dir not found or not a directory: ${projectDir}`);
  process.exit(1);
}

const skillName = skillDir.split("/").filter(Boolean).pop()!;
const dest = join(projectDir, "skills", skillName);
mkdirSync(join(projectDir, "skills"), { recursive: true });
console.log(`Copying ${skillDir} → ${dest}`);
cpSync(skillDir, dest, { recursive: true });

const skillMd = join(dest, "SKILL.md");
if (!existsSync(skillMd)) {
  console.warn(`WARN: ${skillMd} not found. Claude Agent SDK skills require a SKILL.md.`);
}

console.log(`Re-uploading persona "${persona}"...`);
execSync(
  `npx tsx ${join(import.meta.dirname ?? "scripts", "upload-project.ts")} --name ${persona} --dir ${projectDir} --profile ${profile} --stack ${stack} --region ${region}`,
  { stdio: "inherit" }
);
console.log(`Skill "${skillName}" added to persona "${persona}".`);
