---
name: aws-status
description: Check status of common AWS resources for the configured account. Use when the user asks about EC2 instances, ECS services, Lambda functions, or general AWS health.
---

# AWS Status

Reports current state of common resources in the AWS account whose credentials live in `.env`.

## Usage

Run `bash scripts/check.sh <region>` to print a summary of:

- Running EC2 instances
- ECS clusters and active services
- Lambda functions modified in the last 7 days
- CloudFormation stacks not in `*_COMPLETE` status

## Notes

- Sources `.env` first to pick up `AWS_PROFILE` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
- Read-only — never mutates resources.
- If a region is not specified, defaults to `us-east-1`.
