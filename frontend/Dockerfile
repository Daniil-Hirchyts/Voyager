FROM node:22-alpine

RUN npm install -g bun

WORKDIR /workspace/frontend

COPY frontend/package.json frontend/bun.lockb ./
RUN bun install --frozen-lockfile

EXPOSE 5173
