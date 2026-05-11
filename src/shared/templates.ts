import {
  S3Client,
  CopyObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getTemplate, updatePersonaTemplateLink, getPersona } from "./dynamo.js";

const BUCKET = process.env.BUCKET_NAME!;
// All bucket-side keys live under `${BUCKET_PREFIX}` so the S3 Files access
// point can be rooted at /lambda with CreationPermissions (uid 1001 / 750)
// to satisfy Lambda's PosixUser. Worker still sees them at /mnt/s3/* because
// the access point translates /lambda/foo -> /foo on the mount.
export const BUCKET_PREFIX = "lambda/";
const s3 = new S3Client({});

export function templateS3Prefix(templateName: string): string {
  return `${BUCKET_PREFIX}templates/${templateName}/`;
}

export function projectS3Prefix(personaName: string): string {
  return `${BUCKET_PREFIX}personas/${personaName}/`;
}

export function memoryS3Prefix(personaName: string): string {
  return `${BUCKET_PREFIX}memory/${personaName}/`;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((k) => ({ Key: k })) },
      })
    );
  }
}

/**
 * Copy the given template's tree into the persona's prefix in S3 and update
 * the persona META to point at it. Does NOT touch `memory/<persona>/` (that
 * lives under a sibling prefix and is intentionally untouched).
 *
 * Existing files under the persona prefix that are NOT in the template are
 * deleted so the persona prefix is a faithful mirror of the template.
 */
export async function applyTemplateToPersona(
  personaName: string,
  templateName: string
): Promise<{ s3Key: string; templateSha: string }> {
  const template = await getTemplate(templateName);
  if (!template) throw new Error(`template ${templateName} not found`);

  const srcPrefix = template.s3Key || templateS3Prefix(templateName);
  const dstPrefix = projectS3Prefix(personaName);

  const srcKeys = await listKeys(srcPrefix);
  if (srcKeys.length === 0) throw new Error(`template prefix is empty: s3://${BUCKET}/${srcPrefix}`);

  const writtenSuffixes = new Set<string>();
  for (const srcKey of srcKeys) {
    const suffix = srcKey.slice(srcPrefix.length);
    if (!suffix) continue;
    const dstKey = `${dstPrefix}${suffix}`;
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${encodeURIComponent(srcKey).replace(/%2F/g, "/")}`,
        Key: dstKey,
        MetadataDirective: "REPLACE",
        Metadata: {
          template: templateName,
          "template-sha": template.sha256 ?? "",
        },
      })
    );
    writtenSuffixes.add(suffix);
  }

  // Prune anything in the persona prefix that wasn't in the template.
  const existingKeys = await listKeys(dstPrefix);
  const toDelete = existingKeys.filter((k) => !writtenSuffixes.has(k.slice(dstPrefix.length)));
  if (toDelete.length) await deleteKeys(toDelete);

  await updatePersonaTemplateLink(
    personaName,
    templateName,
    template.sha256 ?? "",
    dstPrefix
  );

  return { s3Key: dstPrefix, templateSha: template.sha256 ?? "" };
}

/**
 * Re-apply the persona's currently linked template. Errors if persona has no
 * templateName set.
 */
export async function reprovisionPersona(
  personaName: string
): Promise<{ s3Key: string; templateSha: string; templateName: string }> {
  const persona = await getPersona(personaName);
  if (!persona) throw new Error(`persona ${personaName} not found`);
  if (!persona.templateName) throw new Error(`persona ${personaName} has no template link`);
  const r = await applyTemplateToPersona(personaName, persona.templateName);
  return { ...r, templateName: persona.templateName };
}

/**
 * Check if a template's prefix has any objects (rough sanity check).
 */
export async function templateExists(templateName: string): Promise<boolean> {
  const prefix = templateS3Prefix(templateName);
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: `${prefix}CLAUDE.md` })
    );
    return true;
  } catch {
    const keys = await listKeys(prefix);
    return keys.length > 0;
  }
}
