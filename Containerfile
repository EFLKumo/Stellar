FROM docker.io/library/node:26-bookworm-slim AS build

WORKDIR /app
RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM docker.io/library/node:26-bookworm-slim AS runtime

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/apps/web

COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/package.json /app/package.json
COPY --from=build --chown=node:node /app/tsconfig.json /app/tsconfig.json
COPY --from=build --chown=node:node /app/apps/web /app/apps/web
COPY --from=build --chown=node:node /app/packages/ui /app/packages/ui
COPY --chown=node:node --chmod=0755 scripts/entrypoint.sh /app/scripts/entrypoint.sh

USER node
EXPOSE 3000
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
