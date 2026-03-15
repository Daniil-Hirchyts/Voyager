FROM node:22-alpine AS keycloakify-builder

RUN apk add --no-cache maven && npm install -g bun

WORKDIR /workspace/frontend

COPY frontend/package.json frontend/bun.lockb ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
RUN bun run build-keycloak-theme


FROM quay.io/keycloak/keycloak:26.0

USER root

COPY --from=keycloakify-builder /workspace/frontend/dist_keycloak/*.jar /opt/keycloak/providers/
COPY infra/keycloak/realm-travel.json /opt/keycloak/data/import/realm-travel.json
COPY infra/keycloak/voyager-keycloak-entrypoint.sh /opt/keycloak/bin/voyager-keycloak-entrypoint.sh

RUN chmod 0555 /opt/keycloak/bin/voyager-keycloak-entrypoint.sh

USER keycloak
