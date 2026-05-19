# syntax=docker/dockerfile:1.7
FROM public.ecr.aws/lambda/nodejs:22

ARG TARGETARCH

# Tools + gh in one RUN so tar/unzip from dnf are guaranteed on-disk (avoids bad
# cross-layer BuildKit cache where a stale dnf layer lacked tar).
RUN dnf install -y \
      git tar gzip unzip jq python3 python3-pip shadow-utils \
      ca-certificates which findutils curl-minimal \
 && dnf clean all \
 && ln -sf /var/lang/bin/python3 /usr/local/bin/python || true \
 && set -eux; \
    case "${TARGETARCH:-$(uname -m)}" in \
      amd64|x86_64) GH_ARCH=amd64 ;; \
      arm64|aarch64) GH_ARCH=arm64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    GH_VER=2.62.0; \
    curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VER}/gh_${GH_VER}_linux_${GH_ARCH}.tar.gz" -o /tmp/gh.tgz; \
    tar xzf /tmp/gh.tgz -C /tmp; \
    cp "/tmp/gh_${GH_VER}_linux_${GH_ARCH}/bin/gh" /usr/local/bin/gh; \
    rm -rf /tmp/gh.tgz "/tmp/gh_${GH_VER}_linux_${GH_ARCH}"; \
    gh --version | head -1

# AWS CLI v2 — multi-arch
RUN set -eux; \
    case "${TARGETARCH:-$(uname -m)}" in \
      amd64|x86_64) AWS_ARCH=x86_64 ;; \
      arm64|aarch64) AWS_ARCH=aarch64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}.zip" -o /tmp/awscliv2.zip; \
    unzip -q /tmp/awscliv2.zip -d /tmp; \
    /tmp/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli; \
    rm -rf /tmp/aws /tmp/awscliv2.zip; \
    aws --version

# Build the worker
WORKDIR /build
COPY src/worker/package.json src/worker/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY src/worker/ ./src/worker/
COPY src/shared/ ./src/shared/

RUN npx tsc \
  --target ES2022 \
  --module ES2022 \
  --moduleResolution bundler \
  --esModuleInterop \
  --skipLibCheck \
  --outDir dist \
  --rootDir src \
  src/worker/index.ts

# Lay the compiled code + deps + (ESM) package.json under LAMBDA_TASK_ROOT.
RUN cp -r /build/dist/. ${LAMBDA_TASK_ROOT}/ \
 && cp -r /build/node_modules ${LAMBDA_TASK_ROOT}/node_modules \
 && cp /build/package.json ${LAMBDA_TASK_ROOT}/package.json

# Lambda RIC: <relative-path-from-task-root>.<exported-fn>
CMD ["worker/index.handler"]
