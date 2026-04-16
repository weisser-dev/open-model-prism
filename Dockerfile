# Stage 1: Build Frontend
# --platform=$BUILDPLATFORM runs on the CI host (amd64) — avoids QEMU crashes.
# Frontend output is static HTML/JS/CSS — platform-independent.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Install server dependencies
# Also runs on the build host — all deps are pure JavaScript (bcryptjs, mongoose,
# undici, etc.), so the resulting node_modules work on any architecture.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps-builder
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

# Stage 3: Production runtime (multi-arch — amd64 + arm64)
FROM node:22-alpine
RUN apk upgrade --no-cache
WORKDIR /app

# Copy pre-built node_modules from deps-builder (pure JS, no native bindings)
COPY --from=deps-builder /app/node_modules ./node_modules
COPY server/package*.json ./

# Remove npm, npx, and corepack — not needed at runtime.
# Eliminates CVEs in npm's transitive deps (minimatch, tar, glob, etc.)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

# Copy server code
COPY server/ ./

# Copy CHANGELOG.md for the in-app changelog modal
COPY CHANGELOG.md ./CHANGELOG.md

# Copy built frontend
COPY --from=frontend-builder /app/frontend/dist ./public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/health || exit 1

CMD ["node", "index.js"]
