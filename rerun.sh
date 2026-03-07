#!/bin/bash
set -e

echo "🔄 Stopping all backend services..."
docker compose down

echo "🚀 Starting backend services (API, Worker, DB, Redis, Keycloak)..."
docker compose up -d --build

echo "✅ Backend services restarted successfully!"

echo "🛑 Stopping existing frontend server if running..."
lsof -ti:5173 | xargs kill -9 2>/dev/null || true

echo "🚀 Starting frontend dev server..."
cd frontend
bun run dev
