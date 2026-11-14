FROM node:24.22.1-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
COPY public ./public
RUN npm run generate && npm run build

FROM build AS migrate
COPY --chmod=755 scripts/migrate.sh /app/scripts/migrate.sh
USER node
CMD ["/app/scripts/migrate.sh"]

FROM node:24.22.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY docs/openapi.json ./docs/openapi.json
COPY --from=build /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
