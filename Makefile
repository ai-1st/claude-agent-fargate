PROFILE := co
STACK_NAME := claude-agent-fargate
REGION := us-east-1

export PATH := $(shell pwd)/node_modules/.bin:$(PATH)

.PHONY: build deploy push-image sam-build sam-deploy clean

build: push-image sam-build

deploy: push-image sam-deploy

sam-build:
	sam build --profile $(PROFILE)

sam-deploy: sam-build
	sam deploy --profile $(PROFILE)

push-image:
	./scripts/deploy.sh $(PROFILE) $(STACK_NAME) $(REGION)

install:
	npm install

clean:
	rm -rf .aws-sam dist node_modules
