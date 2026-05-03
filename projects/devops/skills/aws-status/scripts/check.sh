#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-east-1}"

[ -f .env ] && set -a && . .env && set +a

echo "=== EC2 (running) in $REGION ==="
aws ec2 describe-instances --region "$REGION" \
  --filters Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
  --output table || true

echo "=== ECS clusters in $REGION ==="
aws ecs list-clusters --region "$REGION" --query 'clusterArns' --output table || true

echo "=== Lambda functions modified <7 days ==="
SINCE=$(date -u -v-7d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S)
aws lambda list-functions --region "$REGION" \
  --query "Functions[?LastModified>='${SINCE}'].[FunctionName,Runtime,LastModified]" \
  --output table || true

echo "=== CloudFormation stacks not COMPLETE ==="
aws cloudformation list-stacks --region "$REGION" \
  --query "StackSummaries[?StackStatus!='CREATE_COMPLETE' && StackStatus!='UPDATE_COMPLETE' && StackStatus!='DELETE_COMPLETE'].[StackName,StackStatus]" \
  --output table || true
