# SmartOffice — Project Plan

On-premise workplace mapping and workspace management platform. Single site, self-hosted, staged delivery.

## Principles

- **On-premise, single site.** Runs entirely on a local server, no cloud dependency for core function. Schema carries a `site_id` from day one so a second location doesn't require a redesign, but multi-site UI/logic is not built now.
- **Self-hosted, open-source stack.** PostgreSQL in Docker, no paid services required for the core system.
- **Staged delivery.** Each stage ships something usable rather than one large release.
- **AI is a later layer, not a starting point.** The AI/MML layer (Stage 10) is deferred until the structured data underneath it exists and is reliable.

## Architecture

```
                         ON-PREM SERVER (Docker Compose)
                    ┌───────────────────────────────────────┐
                    │                                       │
  LAN clients  ───▶ │   backend (serves the built frontend  │
  (PC / tablet /    │   directly + the API, one port)       │
   phone)           │        │                              │
                    │        ├── postgres (Docker volume)   │
                    │        └── uploads volume              │
                    │            (employee & workspace       │
                    │             photos)                    │
                    └───────────────────────────────────────┘
```

- No reverse proxy — this only runs on the LAN, so there's no TLS termination or external routing to justify one. The backend serves the frontend's static build directly, so it's one process on one port; if a proxy is ever needed later (multiple services, a friendlier hostname), it's a one-line addition to `docker-compose.yml`, not a redesign.
- Postgres and the uploads directory are Docker named volumes — back up both (`pg_dump` on a schedule + volume copy) since there is no cloud redundancy behind this.
- Backend language/framework and frontend framework are intentionally undecided until Stage 3 — Postgres-in-Docker is the only infrastructure decision locked in now.
- **Known exception:** if a later feature captures employee photos directly from a webcam in the browser (`getUserMedia`), that API is blocked on plain HTTP unless the origin is `localhost` — it would need HTTPS or local access at that point. Plain file-upload photos aren't affected. Not a reason to add anything now.

## Data Model (draft)

| Table | Purpose |
|---|---|
| `sites` | Physical location (only one row for now, but present) |
| `floors` | Floors within a site |
| `workspaces` | Desks, rooms, or other bookable/assignable spaces |
| `workspace_types` | Desk / office / meeting room / parking / locker / other |
| `labels` | Free-text annotations placed on the floor map (zones, area names) |
| `employees` | Local directory: name, email, department, team, job title, photo |
| `teams` / `departments` | Organizational grouping |
| `workspace_assignments` | Permanent employee↔desk relationship |
| `bookings` | Temporary, date-scoped employee↔desk relationship |
| `photos` | Employee photos and workspace/equipment photos, stored on local disk, referenced by path |
| `import_logs` | Record of spreadsheet imports: who, when, row count, errors |
| `audit_logs` | Who changed what, when (assignments, layout edits) |

Assignment and booking stay separate tables — a desk can be permanently assigned to someone who isn't in the office today.

## Staged Roadmap

| Stage | Goal | Deliverable | Status |
|---|---|---|---|
| 0 | Infrastructure | `docker-compose.yml` bringing up Postgres + backend (serving the frontend build directly); backup script | Not started |
| 1 | UI prototype | Interactive floor map: draggable desks, labels, background image import, edit mode | **Done** (`prototype/index.html`) |
| 2 | Data model & migrations | Postgres schema above, migration tooling chosen and applied | Not started |
| 3 | Backend API | CRUD endpoints for sites/floors/workspaces/employees/teams/assignments/bookings, Dockerized, talks to Postgres over the internal network | Not started |
| 4 | Frontend wired to real API | Replace the prototype's `localStorage` persistence with real API calls; same interaction model already validated in Stage 1 | Not started |
| 5 | Employee directory & spreadsheet import | Admin uploads a CSV/XLSX (e.g. HR export); column mapping; import log; this is the seed-data mechanism until/unless a directory sync is added later | Not started |
| 6 | Photo linking | Employee photo upload; optional workspace/equipment photos; stored on local disk (Docker volume), not cloud storage | Not started |
| 7 | Workspace assignment | Admin assigns/unassigns/reassigns employees to desks; assignment history | Not started |
| 8 | Booking | Date-scoped temporary booking on top of assignment; booking states (available/held/booked/checked-in/expired/cancelled) | Not started |
| 9 | Authentication | Local accounts first (bcrypt); defer LDAP/AD/Entra integration | Not started |
| 10 | Basic analytics | Utilization once enough booking/assignment data exists | Not started |
| 11 | AI / MML layer | Local LLM (e.g. via Ollama, self-hosted) behind the same backend API, translating natural-language queries ("where is John?", "find a desk near IT") into API calls against the now-structured data | Deferred |
| 12 | Future / optional | AD/Entra sync, access control, Wi-Fi/sensor presence, multi-site rollout | Deferred, only if needed |

## Open Decisions

- Backend language/framework — needs to be picked before Stage 3.
- Frontend framework — the prototype is plain JS; decide whether to keep it that way or move to a framework before the Stage 4 rewrite.
- Migration tool (e.g. Prisma Migrate, node-pg-migrate, Flyway).
- Spreadsheet import format — fixed template vs. flexible column mapping.
- Photo storage limits (max size, allowed types, retention).

## Risks Already Identified

- **Single on-prem server = single point of failure.** No cloud redundancy behind this — backups are a requirement, not an afterthought.
- **Employee photos + location/assignment data are sensitive.** Access control (who can see whose desk/photo) needs to be designed in Stage 9, not bolted on later.
- **Floor plan editing scope.** Deliberately kept to desk placement + free-text labels over an uploaded background image — no wall-drawing/CAD tooling, by decision (tried and removed from the prototype).
