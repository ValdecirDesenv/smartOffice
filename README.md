# SmartOffice

A self-hosted workplace mapping and directory tool for managing multiple offices: interactive floor maps with desks/rooms/devices, an employee directory, desk assignments, and admin tooling — all running on your own infrastructure via Docker Compose.

## Features

- **Interactive floor maps** — per-office, per-floor maps with draggable desks, rooms, labels, and devices (TVs, printers, etc.) over an uploaded floor-plan image. Live status per desk (available / occupied / reserved / assigned).
- **Multi-office support** — any number of offices, each with its own floors, teams, and directory; a collapsible sidebar for navigating between them, plus a cross-site people search that jumps straight to wherever someone is seated.
- **Employee directory** — per-office and read-only "All Offices" views, teams/departments, desk assignment/unassignment.
- **Authentication & roles** — cookie-based sessions, invite-only account creation, password reset by email, and three roles: admin, member (can edit), and guest (view-only).
- **Audit log** — every manual write (create/update/delete on any entity) is recorded with before/after values and who made it.
- **HubSpot sync** *(optional)* — pulls employee data (name, title, team, headshot, employment status) from a HubSpot HubDB table into the local directory; automatically removes former employees with no desk and flags former employees who still have one.
- **Admin config snapshots** — save the current sites/floors/desks/employees/assignments as a named snapshot and reload it later to undo unwanted changes; keeps up to 3 snapshots.

## Architecture

```
                    ON-PREM / SELF-HOSTED (Docker Compose)
              ┌───────────────────────────────────────────┐
  Browser ──▶ │  core-api (Fastify + TypeScript)           │
              │    serves the built React frontend          │
              │    and the JSON API on one port             │
              │        │                                     │
              │        ├── postgres (schema-migrated on boot)│
              │        └── uploads volume (floor-plan images)│
              └───────────────────────────────────────────┘
```

- **`core-api/`** — Fastify + TypeScript backend. REST API under `/api/*`, `node-pg-migrate` migrations run automatically on container start, serves the frontend's static build directly (no separate web server needed).
- **`frontend/`** — React + Vite + TypeScript + Tailwind CSS.
- **Postgres** — single source of truth; every table change goes through a migration file in `core-api/src/db/migrations/`.
- No reverse proxy or TLS termination — this is designed to run on a LAN. See `docker-compose.yml`'s `cloudflared` service for one way to expose it externally without a domain (a free Cloudflare Quick Tunnel).

See `docs/PROJECT_PLAN.md` for the fuller design rationale, data model, and staged roadmap this project was built against.

## Getting started

1. Copy `.env.example` to `.env` and fill in at least `POSTGRES_PASSWORD` and `SESSION_COOKIE_SECRET` (generate one with `openssl rand -hex 32`). Everything else is optional — see the comments in `.env.example`.
2. Build and start everything:
   ```
   docker compose up -d --build
   ```
   This starts Postgres, runs migrations, and starts `core-api` serving the app at `http://localhost:8090`.
3. Create the first admin account (signup is invite-only, so nothing can invite the first user):
   ```
   docker compose exec core-api node dist/scripts/create-admin.js \
     --username admin --email admin@example.com --password 'change-me-now'
   ```
4. Log in at `http://localhost:8090` and invite additional users from the Users page.

## Local development

Each side has its own dev server with hot reload:

```
# Backend (needs a running Postgres — see docker-compose.yml)
cd core-api
npm install
npm run dev            # tsx watch, http://localhost:8080
npm run migrate:up      # apply pending migrations
npm run typecheck

# Frontend
cd frontend
npm install
npm run dev             # Vite, http://localhost:5173 (proxies /api to core-api)
npm run typecheck
```

Or run the whole stack (frontend with hot reload included) via Compose:
```
docker compose up
```

## Environment variables

See `.env.example` for the full list with descriptions. Required: `POSTGRES_PASSWORD`, `SESSION_COOKIE_SECRET`. Optional: `PUBLIC_BASE_URL` (for email links), `GMAIL_USER`/`GMAIL_APP_PASSWORD` (to actually send invite/reset emails instead of just logging them), `HUBSPOT_ACCESS_TOKEN` (to enable the HubSpot sync).

## Backups

The `backup` service in `docker-compose.yml` runs a daily `pg_dump` of the database (kept 7 days / 4 weeks / 6 months) to the `pgbackups` volume. The `uploads` volume (floor-plan images) should be backed up separately.
