# Node 25+ no longer bundles corepack, so install it once and copy this stage's node into the others.
FROM node:26-bookworm-slim AS node
RUN npm install -g corepack

# The web app, which also compiles the firmware (ESP-IDF from the base image, IDF_PATH is set).
FROM node AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build validates the env vars (see src/env.ts) but doesn't inline them: placeholders are enough.
RUN ORIGIN=http://localhost BETTER_AUTH_SECRET=build-placeholder pnpm build

# Development: `vite dev` with the source bind-mounted (see docker-compose.dev.yaml).
FROM espressif/idf:v5.5.6 AS dev
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack && corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
CMD ["sh", "-c", "pnpm install && pnpm dev"]

FROM espressif/idf:v5.5.6
COPY --from=node /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATA_DIR=/data
VOLUME /data
EXPOSE 3000

# The base image's entrypoint sources ESP-IDF's export.sh, then runs this.
CMD ["node", "build"]
