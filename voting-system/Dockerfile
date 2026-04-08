# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.title="GVote"
LABEL org.opencontainers.image.description="Anonymous voting hosting platform"
LABEL org.opencontainers.image.source="https://github.com/davidstacks/voting-service"

# Non-root user for security
RUN addgroup -S gvote && adduser -S gvote -G gvote

WORKDIR /app

# Copy deps from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY --chown=gvote:gvote . .

# Persistent volume for SQLite DB
RUN mkdir -p /data && chown gvote:gvote /data
VOLUME ["/data"]

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/voting.db

USER gvote
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
