#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-ce}"
STACK_NAME="${2:-claude-agent-serverless}"
REGION="${3:-us-east-1}"

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)
ECR_REPO_NAME="${STACK_NAME}-worker"
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO_NAME}"
ECR_URI="${ECR_REPO}:latest"

echo "=== Ensuring ECR repo ${ECR_REPO_NAME} ==="
aws ecr describe-repositories --profile "$PROFILE" --region "$REGION" \
  --repository-names "$ECR_REPO_NAME" >/dev/null 2>&1 \
  || aws ecr create-repository --profile "$PROFILE" --region "$REGION" \
       --repository-name "$ECR_REPO_NAME" \
       --image-scanning-configuration scanOnPush=true >/dev/null

echo "=== Logging into ECR ==="
aws ecr get-login-password --profile "$PROFILE" --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "=== Building arm64 image (Lambda requires single-arch, OCI v2 manifest) ==="
docker buildx create --name multiarch --driver docker-container --use 2>/dev/null || docker buildx use multiarch
docker buildx build \
  --platform linux/arm64 \
  -f src/worker/Dockerfile \
  -t "${ECR_URI}" \
  --provenance=false \
  --output type=image,oci-mediatypes=false,push=true \
  .

echo "=== Image pushed to ${ECR_URI} ==="
