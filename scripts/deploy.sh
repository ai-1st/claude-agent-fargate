#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-ce}"
STACK_NAME="${2:-claude-agent-fargate}"
REGION="${3:-us-east-1}"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${STACK_NAME}-worker"
ECR_URI="${ECR_REPO}:latest"

echo "=== Logging into ECR ==="
aws ecr get-login-password --profile "$PROFILE" --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "=== Building multi-arch image ==="
docker buildx create --name multiarch --driver docker-container --use 2>/dev/null || docker buildx use multiarch
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -f src/worker/Dockerfile \
  -t "${ECR_URI}" \
  --provenance=false \
  --push \
  .

echo "=== Image pushed to ${ECR_URI} ==="
