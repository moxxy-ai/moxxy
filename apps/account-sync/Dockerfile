FROM node:24-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable
COPY . .

RUN pnpm --filter @moxxy/account-sync... install --frozen-lockfile \
    && pnpm --filter @moxxy/desktop-ipc-contract... run build \
    && pnpm --filter @moxxy/account-sync test \
    && pnpm --filter @moxxy/account-sync exec esbuild server.mjs --bundle --platform=node --format=esm --target=node24 --outfile=/out/server.mjs

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4781
WORKDIR /app
COPY --from=build /out/server.mjs ./
USER node
EXPOSE 4781
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "server.mjs"]
