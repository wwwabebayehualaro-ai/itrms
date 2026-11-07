# syntax=docker/dockerfile:1.7
# The ITRMS images (task 0.26a, ADR-0008): one build of the monorepo, then a small image per process.
#   api        the HTTP API; the same image runs `worker`, `migrate` and the seeds (`node dist/<process>.cjs`)
#   documents  the PDF worker: the API image with Chromium
#   web        the staff app (Next.js standalone server, the BFF)
#   edge       Nginx: TLS, the public exposure rules (infra/compose/nginx) and the verifier's static export
#   gate       a TCP gate between two networks, one port each (infra/docker/gate.sh)
#   egress     the only route out: Squid, to an allowlist (infra/docker/egress.sh)
# Built by CI and published on a release tag (.github/workflows/release.yml); infra/compose/production.yml runs them.

# pinned by digest, as docker-compose.yml's images are (two builds of one release are the same)
ARG NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
ARG NGINX_IMAGE=nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
ARG ALPINE_IMAGE=alpine:3.22@sha256:bfe7ceb9f09ec0566c48fb93356e45a47a00be5a1dd14fa5b909e7709c66b034

FROM ${NODE_IMAGE} AS build
ENV CI=1 LEFTHOOK=0 NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.9.1
WORKDIR /repo
COPY . .
# one flat node_modules: the API bundle requires its npm packages from it at run time (apps/api/webpack.config.cjs). The
# repository's own scripts (git hooks) have no git here: only the packages' build scripts run (rebuild)
RUN pnpm install --frozen-lockfile --config.node-linker=hoisted --ignore-scripts && pnpm rebuild
RUN pnpm --filter @itrms/api build \
    && NEXT_OUTPUT=standalone pnpm --filter @itrms/web build \
    && pnpm --filter @itrms/verify build
# then only what runs: the development packages go
RUN pnpm install --frozen-lockfile --prod --config.node-linker=hoisted --ignore-scripts && pnpm rebuild \
    && mkdir -p apps/api/node_modules

FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production TZ=Africa/Addis_Ababa
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
# what could not be shared at the top (another version, or peers of its own) stays under the API, where its bundle finds it first
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/drizzle ./apps/api/drizzle
# the seeds a fresh installation (and the demo) is made from, at the paths the seed commands name from apps/api
COPY --from=build /repo/apps/api/seed ./apps/api/seed
COPY --from=build /repo/modules/competency/seed ./modules/competency/seed
COPY --from=build /repo/platform/services/seed ./platform/services/seed
# the processes run from apps/api, and read their packages' files (the PDFs' fonts) from its node_modules
RUN [ -e /app/apps/api/node_modules/@fontsource ] || ln -s /app/node_modules/@fontsource /app/apps/api/node_modules/@fontsource
WORKDIR /app/apps/api
USER node
EXPOSE 4000
CMD ["node", "--enable-source-maps", "dist/main.cjs"]

FROM api AS documents
USER root
# Chromium for the PDF worker, and the Ethiopic fonts it prints with come from the bundle (@fontsource)
RUN apt-get update \
    && apt-get install --yes --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
ENV CHROME_PATH=/usr/bin/chromium
USER node
CMD ["node", "--enable-source-maps", "--max-old-space-size=512", "dist/worker-documents.cjs"]

FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 TZ=Africa/Addis_Ababa NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

FROM ${NGINX_IMAGE} AS edge
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/compose/nginx/itrms.conf.template /etc/nginx/templates/itrms.conf.template
COPY infra/compose/nginx/itrms-proxy.conf infra/compose/nginx/itrms-s3-proxy.conf /etc/nginx/
COPY --from=build /repo/apps/verify/out /srv/verify

FROM ${ALPINE_IMAGE} AS egress
# Squid as the egress proxy: HTTPS (CONNECT) to the hosts in ITRMS_EGRESS_ALLOW (comma-separated), nothing else
RUN apk add --no-cache squid
COPY infra/docker/egress.sh /usr/local/bin/egress
RUN chmod 0755 /usr/local/bin/egress
EXPOSE 3128
CMD ["egress"]

FROM ${NGINX_IMAGE} AS gate
COPY infra/docker/gate.sh /usr/local/bin/gate
RUN chmod 0755 /usr/local/bin/gate
CMD ["gate"]
