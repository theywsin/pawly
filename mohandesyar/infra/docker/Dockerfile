# One image for the API (cluster primary + workers), the migrate job and the built SPA it serves.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable
WORKDIR /src
# Every workspace package (apps, packages, tools and all business modules) takes part in the frozen
# install, so the whole tree is copied first; .dockerignore keeps node_modules and build output out.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mohandesyar/module-sdk build \
 && pnpm --filter @mohandesyar/persian build \
 && pnpm --filter @mohandesyar/export build \
 && pnpm --filter @mohandesyar/module-package build \
 && pnpm --filter @mohandesyar/module-cli build \
 && pnpm --filter @mohandesyar/web build \
 && pnpm --filter @mohandesyar/api build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    WEB_DIST_DIR=/app/apps/web/dist \
    MODULE_STORE_DIR=/var/lib/mohandesyar/modules \
    MODULE_UPLOAD_DIR=/var/lib/mohandesyar/uploads \
    MODULE_BACKUP_DIR=/var/lib/mohandesyar/module-backups
RUN useradd --system --uid 10001 --home /app mohandesyar \
 && mkdir -p /var/lib/mohandesyar && chown mohandesyar /var/lib/mohandesyar
WORKDIR /app
COPY --from=build --chown=mohandesyar /src /app
USER mohandesyar
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "apps/api/dist/main.js"]
CMD ["serve"]
