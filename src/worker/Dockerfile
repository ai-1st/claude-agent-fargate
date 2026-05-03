# syntax=docker/dockerfile:1.7
FROM node:20-slim

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends git curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY src/worker/package.json src/worker/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY src/worker/index.ts ./src/worker/index.ts
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

CMD ["node", "dist/worker/index.js"]
