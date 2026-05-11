PROFILE := co
STACK_NAME := claude-agent-serverless
REGION := us-east-1

export PATH := $(shell pwd)/node_modules/.bin:$(PATH)

.PHONY: build deploy push-image sam-build sam-deploy sync-templates clean

build: push-image sam-build

deploy: push-image sam-deploy sync-templates

sam-build:
	sam build --profile $(PROFILE)

sam-deploy: sam-build
	sam deploy --profile $(PROFILE)

sync-templates:
	npx tsx scripts/sync-templates.ts --profile $(PROFILE) --stack $(STACK_NAME) --region $(REGION)

push-image:
	./scripts/deploy.sh $(PROFILE) $(STACK_NAME) $(REGION)

install:
	npm install

clean:
	rm -rf .aws-sam dist node_modules
