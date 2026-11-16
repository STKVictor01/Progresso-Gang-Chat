FROM node:24.22.3-bookworm-slim AS build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build
FROM caddy:2.11.9-alpine
COPY --from=build /app/client/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
