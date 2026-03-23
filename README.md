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
