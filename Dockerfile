# Pinky as one cloud service (fly.toml; any container host works). One Node process serves the built app and the API on
# $PORT. Storage: PostgreSQL when the DATABASE_URL secret is set, otherwise the JSON file at TOWARD_US_DATA_FILE (on a volume).
FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# Dev dependencies stay installed, as on Render: the build needs tsc and vite, and the read-only web lookup
# (server/readonly-web.mjs) drives Playwright's Chromium at runtime.
COPY package.json package-lock.json .npmrc ./
RUN npm ci --include=dev
RUN npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm run build

# The commit the running build came from; /api/health reports it so open Apps reload onto a new build.
ARG BUILD_COMMIT=""
ENV BUILD_COMMIT=$BUILD_COMMIT PORT=8080
EXPOSE 8080
CMD ["node", "server/index.mjs", "--production"]
