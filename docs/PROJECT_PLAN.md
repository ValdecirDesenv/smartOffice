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
| `workspace_types` | Desk / office / meeting room / parking / locker / other (global lookup, seeded) |
| `labels` | Free-text annotations placed on the floor map (zones, area names) |
| `employees` | Local directory: name, email, team, job title, photo |
| `teams` | Organizational grouping (name + department) |
| `workspace_assignments` | Permanent employee↔desk relationship (unassign sets `unassigned_at`, preserving history) |
| `bookings` | Temporary, date-scoped employee↔desk relationship |
| `photos` | Employee photos and workspace/equipment photos, stored on local disk, referenced by path |
| `import_logs` | Record of spreadsheet imports: who, when, row count, errors |
| `audit_logs` | Who changed what, when (assignments, layout edits); every manual/spreadsheet write logs one row |
| `devices` | Monitor/dock/laptop/phone etc. tracked per desk; identified by serial/asset tag across all ingestion sources |
| `device_types` | Device category lookup (global, seeded) |
| `ingestion_events` | Raw per-row/per-event payload log for spreadsheet and camera sources, before interpretation |
| `change_proposals` | Review queue for camera/AI-sourced changes — nothing from those sources writes directly; a human approves or rejects |

Assignment and booking stay separate tables — a desk can be permanently assigned to someone who isn't in the office today.

**Multi-source data ingestion.** Desk/device occupancy data arrives from three sources, each with a different trust level: manual entry and spreadsheet import are human-triggered and write directly to the tables above (with an `audit_logs` entry); a camera-based system (a separate project, see below) and a future local AI/ML service are not authoritative — their output lands in `change_proposals` and only takes effect once a human approves it. This is what lets "the AI manages data on its own, but flag me if it changes something" work: the entity tables only ever reflect approved state.

The camera source is a sibling project, `SecurityCameraSmartTrack` (NVIDIA DeepStream + MQTT + self-hosted Ollama, on-prem GPU, no cloud calls) — it currently does person detection/tracking for security behaviors, not desk-zone mapping, so translating tracked people into "who's at which desk" is new work, not something it already provides.

## Staged Roadmap

| Stage | Goal | Deliverable | Status |
|---|---|---|---|
| 0 | Infrastructure | `docker-compose.yml` bringing up Postgres + core-api (serving the frontend build directly) + daily backup sidecar | **Done** |
| 1 | UI prototype | Interactive floor map: draggable desks, labels, background image import, edit mode | **Done** (`prototype/index.html`) |
| 2 | Data model & migrations | Postgres schema above (including devices/ingestion/change-proposal tables), `node-pg-migrate`, applied on container boot | **Done** (`core-api/src/db/migrations/`) |
| 3a | Backend API — manual input | Fastify CRUD for sites/floors/workspace-types/workspaces/labels/employees/teams/device-types/devices, plus assign/unassign for workspace_assignments; every write logs to `audit_logs` | **Done** (`core-api/src/modules/`) |
| 3b | Backend API — spreadsheet import | Upload → header parse → column mapping → preview/validate → commit, logged via `import_logs` + `ingestion_events` | Not started |
| 3c | Camera ingestion + AI/ML review queue | Ingestion endpoint for the `SecurityCameraSmartTrack` project's output; a local GPU AI/ML service (Python) that only ever writes to `change_proposals`, never direct to the tables; a review UI to approve/reject | Not started |
| 4 | Frontend wired to real API | Replace the prototype's `localStorage` persistence with real API calls; same interaction model already validated in Stage 1 | Not started |
| 5 | Employee directory & spreadsheet import UI | Same mechanism as 3b, frontend side | Not started |
| 6 | Photo linking | Employee photo upload; optional workspace/equipment photos; stored on local disk (Docker volume), not cloud storage | Not started |
| 7 | Workspace assignment (frontend) | Frontend for the assign/unassign API already built in Stage 3a | Not started |
| 8 | Booking | Date-scoped temporary booking on top of assignment; booking states (available/held/booked/checked-in/expired/cancelled); table exists, no API yet | Not started |
| 9 | Authentication | Local accounts first (bcrypt); defer LDAP/AD/Entra integration. Until this exists, manual writes attribute to an optional `x-actor-id` header, not a real logged-in user | Not started |
| 10 | Basic analytics | Utilization once enough booking/assignment data exists | Not started |
| 11 | AI / ML layer | Local, GPU-accelerated service (Python) that proposes desk/device/employee changes from camera and other signals — always via `change_proposals`, never direct writes; natural-language query is a further extension of the same service | Deferred |
| 12 | Future / optional | AD/Entra sync, access control, Wi-Fi/sensor presence, multi-site rollout | Deferred, only if needed |

## Open Decisions

- ~~Backend language/framework~~ — **decided**: Node.js + TypeScript + Fastify for the core API (`core-api/`); a separate Python service (GPU/CUDA) for AI/ML, built in Stage 3c, never touching Postgres directly.
- Frontend framework — the prototype is plain JS; decide whether to keep it that way or move to a framework before the Stage 4 rewrite.
- ~~Migration tool~~ — **decided**: `node-pg-migrate`, plain SQL wrapped in JS migrations, run automatically on container boot.
- Spreadsheet import format — fixed template vs. flexible column mapping (planned as flexible mapping in Stage 3b, not yet built).
- Photo storage limits (max size, allowed types, retention).
- Whether the Stage 3c/11 AI/ML service shares the `SecurityCameraSmartTrack` project's existing Ollama instance or runs its own — both sit on the same physical GPU (RTX A4000, 16GB VRAM).

## Risks Already Identified

- **Single on-prem server = single point of failure.** No cloud redundancy behind this — backups are a requirement, not an afterthought.
- **Employee photos + location/assignment data are sensitive.** Access control (who can see whose desk/photo) needs to be designed in Stage 9, not bolted on later.
- **Floor plan editing scope.** Deliberately kept to desk placement + free-text labels over an uploaded background image — no wall-drawing/CAD tooling, by decision (tried and removed from the prototype).
