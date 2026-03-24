# Voyager

Voyager runs as a full local Docker stack.


## Quick Start

1. Create your local env file:

```bash
cp .env.example .env
```

2. Start the full stack:

```bash
docker compose up -d --build
```

You can also use:

```bash
make up
```

3. Open the app:

- Frontend: [http://localhost:5173](http://localhost:5173)
- API: [http://localhost:8000/docs](http://localhost:8000/docs)
- Keycloak: [http://localhost:8080](http://localhost:8080)
- Mailpit: [http://localhost:8025](http://localhost:8025)
- RustFS API: [http://localhost:9000](http://localhost:9000)
- RustFS Console: [http://localhost:9001](http://localhost:9001)

## What Is Included

- `frontend`: Vite app served from Docker on port `5173`.
- `api`: FastAPI backend on port `8000`. It also runs DB migrations on startup.
- `worker`: background job worker for async tasks.
- `db`: Postgres + PostGIS for app data.
- `redis`: cache and job/state broker.
- `keycloak`: local auth server for login and OIDC flows.
- `keycloak-db`: separate Postgres database for Keycloak.
- `rustfs`: S3-compatible object storage for uploads/media.
- `mailpit`: local email catcher for testing emails without sending real mail.

## Frontend Technology Choices

| Area | Technology | Why it was chosen |
| --- | --- | --- |
| App runtime | `React 18` + `TypeScript` + `Vite` | Fast local development, a simple build pipeline, and strong typing across the app. |
| Routing | `react-router-dom` | Clean separation between public pages, auth callbacks, and protected workspace routes. |
| Server state | `@tanstack/react-query` | The frontend cache for API data. It handles fetching, retries, stale data, and refetching without custom state code. |
| Typed API layer | `openapi-fetch` + generated OpenAPI types | Keeps frontend requests aligned with the FastAPI contract and reduces request/response mismatch bugs. |
| Auth | `react-oidc-context` + `oidc-client-ts` + `Keycloak` | Uses standard OIDC flows instead of custom auth logic, including redirects, silent renew, and logout. |
| Forms | `react-hook-form` + `zod` | Lightweight form state with runtime validation close to the UI. |
| UI primitives | `Tailwind CSS v4` + `Radix UI` + `class-variance-authority` | Custom styling with accessible low-level components, without locking the app into a heavy design system. |
| Small client state | `zustand` | Used for local UI state that should not live in React Query, such as view and session helpers. |
| Maps and planning | `@vis.gl/react-google-maps`, `deck.gl`, `terra-draw`, `@dnd-kit` | Google Maps provides the base map and places data, deck.gl adds richer overlays, Terra Draw handles geometry editing, and dnd-kit powers planner drag-and-drop. |
| Assistant and content UI | `@assistant-ui/react`, `react-markdown`, `sonner`, `motion` | Focused libraries for chat-style interactions, markdown rendering, toast feedback, and motion without building those pieces from scratch. |
| Keycloak theming | `keycloakify` | Lets Voyager build branded login/account screens with the same frontend stack. |

## Data, Cache, and Infrastructure Choices

| Part | Technology | Why it was chosen |
| --- | --- | --- |
| Main database | `PostgreSQL 16` | Reliable relational storage for trips, days, activities, jobs, users, and metadata. |
| Geospatial database | `PostGIS` | Extends Postgres with spatial types and queries, which fits places, routes, and planner map features. |
| Server cache and transient state | `Redis 7` | Used for short-lived API caches, idempotency keys, progress events, and fast invalidation. This is the backend cache layer. |
| Background processing | `worker` service | Long-running work such as itinerary generation, exports, place-photo refresh, and dedup runs outside the request/response path. |
| API layer | `FastAPI` + `SQLAlchemy` + `Alembic` | A clean async API stack with migrations and a schema-first workflow that matches the generated frontend types. |
| Auth server | `Keycloak` + its own Postgres DB | Keeps identity and OIDC concerns isolated from Voyager business data. |
| Media storage | `RustFS` (S3-compatible) | Binary files and media do not belong in Postgres; object storage is simpler and scales better for uploads and signed URLs. |
| Dev email testing | `Mailpit` | Captures emails locally so auth and invite flows can be tested without sending real mail. |

## How The Stack Works Together

In short: React handles the UI, React Query handles browser-side data caching, FastAPI exposes the API, Postgres/PostGIS stores the core data, Redis handles fast transient state, Keycloak handles identity, and RustFS stores files.
