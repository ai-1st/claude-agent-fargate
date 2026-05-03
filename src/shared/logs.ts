import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const cwl = new CloudWatchLogsClient({});

const LOG_GROUP = process.env.LOG_GROUP_NAME!;
const STREAM_PREFIX = process.env.LOG_STREAM_PREFIX ?? "worker";
const CONTAINER_NAME = process.env.LOG_CONTAINER_NAME ?? "worker";

export function taskIdFromArn(arn: string): string | undefined {
  const parts = arn.split("/");
  return parts[parts.length - 1];
}

export function logStreamName(taskArn: string): string | undefined {
  const id = taskIdFromArn(taskArn);
  if (!id) return undefined;
  return `${STREAM_PREFIX}/${CONTAINER_NAME}/${id}`;
}

export async function getTaskLogs(
  taskArn: string,
  limit = 200
): Promise<string> {
  const stream = logStreamName(taskArn);
  if (!stream) return "";
  try {
    const res = await cwl.send(
      new GetLogEventsCommand({
        logGroupName: LOG_GROUP,
        logStreamName: stream,
        limit,
        startFromHead: false,
      })
    );
    return (res.events ?? [])
      .map((e) => `[${new Date(e.timestamp ?? 0).toISOString().slice(11, 19)}] ${e.message?.replace(/\s+$/, "") ?? ""}`)
      .join("\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ResourceNotFoundException")) return "(log stream not yet created)";
    return `(log fetch error: ${msg})`;
  }
}
