# SmartOffice — Architecture & Workflow

This document explains **how the system is built and how data moves through it** — components, responsibilities, and end-to-end flows. `README.md` covers *what the product does* and *how to run it*; `docs/PROJECT_PLAN.md` covers the original staged roadmap. This one is for a developer who needs to understand the system's shape before touching the code.

All diagrams are [Mermaid](https://mermaid.js.org/) — they render natively on GitHub/GitLab and in VS Code's Markdown preview.

---

## 1. System overview

SmartOffice is a single Fastify process (`core-api`) that serves both the compiled React frontend and the JSON API, backed by Postgres, with one outbound integration (HubSpot) and no other external dependencies.

```mermaid
flowchart TB
    Browser["Browser<br/>(React SPA)"]

    subgraph Server["core-api (Fastify + TypeScript) — one process, one port"]
        Static["Static file server<br/>(frontend's built dist/)"]
        API["/api/* routes<br/>(one module per entity)"]
        Auth["requireAuth hook<br/>(session + role gate)"]
    end

    PG[("PostgreSQL<br/>(all application data)")]
    Uploads[("Uploads volume<br/>(floor-plan images)")]
    HubSpot["HubSpot API<br/>(HubDB employees_v2 table)"]

    Browser <-->|"HTTP: page loads,<br/>fetch() calls"| Server
    Static -.serves.-> Browser
    Auth -->|gates| API
    API <-->|SQL| PG
    API <-->|read/write files| Uploads
    API -->|"HTTPS, admin-triggered sync"| HubSpot
```

**Why one process serves both**: this is designed to run on a LAN with no reverse proxy (see `docs/PROJECT_PLAN.md`'s "on-premise, single site" principle). `core-api`'s Fastify instance registers a static file handler for the frontend's build output *and* the `/api/*` routes side by side (`core-api/src/app.ts`). There's a separate `frontend` Docker Compose service, but it's dev-only (Vite dev server with hot reload, proxying `/api` back to `core-api`) — it never runs in the deployed system.

---

## 2. Component responsibilities

### Frontend (`frontend/`)

React 18 + TypeScript + Vite + Tailwind CSS. No Redux/state library — two React Contexts hold shared state:

| Piece | Responsibility |
|---|---|
| `context/AuthContext.tsx` | Current logged-in user, `canEdit` derivation (`is_admin \|\| can_edit`), login/logout |
| `context/AppContext.tsx` | Current site/floor selection, the sidebar's site/floor lists, **and** an app-wide "directory" snapshot (`directoryEmployees`/`directoryWorkspaces`/`directoryAssignments` — every site, not just the current one) used by cross-site search and Ticket Desk |
| `api/client.ts` | The only place that calls `fetch()` — one method per backend route, typed request/response, throws `ApiError` on non-2xx |
| `pages/*.tsx` | One per route: `FloorMapPage`, `PeoplePage`, `UsersPage`, `ConfigSnapshotsPage`, `DeskTicketsPage`, plus the logged-out auth pages |
| `components/FloorMap/*` | The interactive map itself (`FloorMapCanvas` — desks/labels/devices, drag positioning, status/team-color rendering) and its supporting panels/popovers |
| `components/Sidebar.tsx` / `TopBar.tsx` | Navigation and the People Search / Ticket Desk entry points |

**Request pattern**: every page calls `api.<module>.<method>()` → `fetch()` with the session cookie sent automatically (`credentials` default) → on success, local component state is updated directly (no cache layer); a few flows (Ticket Desk approval, config snapshot restore) also call `refreshDirectory()`/`window.location.reload()` to force other parts of the app to pick up data that changed underneath them.

### Backend (`core-api/`)

Fastify 5 + TypeScript, one module per entity under `src/modules/<name>/<name>.routes.ts`, each exporting a `FastifyPluginAsync` registered with a `/api/<name>` prefix in `app.ts`.

Every mutating route follows the same shape:

```mermaid
flowchart LR
    A["Route handler"] --> B["withTransaction(client => ...)"]
    B --> C["SQL INSERT/UPDATE/DELETE"]
    C --> D["recordAudit(client, {...})"]
    D --> E["COMMIT (or ROLLBACK on error)"]
```

- `db/transact.ts` — `withTransaction()` wraps a callback in `BEGIN`/`COMMIT`/`ROLLBACK`.
- `db/audit.ts` — `recordAudit()` inserts one `audit_logs` row (entity type/id, action, old/new values, who, source) in the *same* transaction as the actual write, so audit history can never drift from reality.
- `middleware/require-auth.ts` — a global `onRequest` hook: resolves the session cookie to a user, rejects unauthenticated `/api/*` requests, and blocks any mutating verb (`POST`/`PUT`/`PATCH`/`DELETE`) for a user who's neither `is_admin` nor `can_edit` — with one narrow, explicit exception for guest-submitted desk tickets (see §5.4).
- `db/migrations/*.js` — `node-pg-migrate`, raw SQL via `pgm.sql(...)`, applied automatically on container start by `docker-entrypoint.sh` before the server starts.

### Local database (Postgres)

Everything the app knows lives in one Postgres database. Tables fall into four groups:

```mermaid
erDiagram
    SITES ||--o{ FLOORS : has
    SITES ||--o{ TEAMS : has
    SITES ||--o{ EMPLOYEES : has
    FLOORS ||--o{ WORKSPACES : has
    FLOORS ||--o{ LABELS : has
    WORKSPACE_TYPES ||--o{ WORKSPACES : "typed as"
    WORKSPACES ||--o{ WORKSPACE_ASSIGNMENTS : "assigned via"
    EMPLOYEES ||--o{ WORKSPACE_ASSIGNMENTS : "assigned via"
    EMPLOYEES }o--|| TEAMS : "belongs to"
    DEVICE_TYPES ||--o{ DEVICES : "typed as"
    WORKSPACES ||--o{ DEVICES : "sits at"
    DESK_REQUESTS }o--|| WORKSPACES : requests
    DESK_REQUESTS }o--o| EMPLOYEES : "for (existing or new)"
```

| Group | Tables | Notes |
|---|---|---|
| **Core directory/layout** | `sites`, `floors`, `workspaces`, `labels`, `teams`, `employees`, `workspace_assignments`, `devices`, `workspace_types`, `device_types` | The data an admin edits directly on the Floor Map / People pages. This is exactly the scope covered by Config Snapshots (§5.3). |
| **Auth** | `users`, `sessions`, `password_reset_tokens`, `invites` | Login accounts — deliberately separate from `employees` (a `users` row *optionally* links to one `employees` row via `employee_id`). Never touched by HubSpot sync or config-snapshot restore. |
| **Workflow / admin tooling** | `desk_requests`, `config_snapshots`, `audit_logs` | Added after the original schema — request queue, saved-state snapshots, and the permanent change log. |
| **Reserved, not yet wired up** | `bookings`, `photos`, `import_logs`, `ingestion_events`, `change_proposals` | Exist in the schema (see `docs/PROJECT_PLAN.md`'s staged roadmap) but have no route module — nothing currently reads or writes them. |

**Why HubSpot data lives inside `employees`, not a separate table**: `employees.hubspot_row_id`, `employees.hubspot_data` (JSONB — the full synced row) and `employees.hubspot_synced_at` are just extra columns on the existing table. A single employee is either purely local, purely HubSpot-sourced, or both merged together — modeling it as one row with optional HubSpot fields avoids a join for every employee read, and the JSONB blob absorbs new HubSpot fields (like `headshot_url`, added later) without a migration.

### HubSpot / HubDB integration

`core-api/src/lib/hubspot.ts` wraps `@hubspot/api-client` and fetches one HubDB table (`employees_v2`, id `131850672`) via `cms.hubdb.rowsApi.getTableRows(...)`, requesting a fixed property list: `first_name`, `last_name`, `preferred_name`, `email`, `role`, `department`, `status`, `mobile_phone_number`, `start_date`, `termination_date`, `registered`, `headshot_url`.

```mermaid
sequenceDiagram
    actor Admin
    participant FE as Frontend
    participant API as POST /api/hubspot/sync-employees
    participant HS as HubSpot HubDB API
    participant DB as Postgres (employees)

    Admin->>API: trigger sync (admin-only)
    API->>HS: getTableRows(employees_v2, [properties])
    HS-->>API: all rows (id + values)
    loop each HubDB row
        API->>DB: match by email, else by name<br/>(first+last, then preferred+last)
        alt matched existing employee
            API->>DB: UPDATE name/job_title/team/status/hubspot_data
        else no local match
            alt row has a name
                API->>DB: INSERT into "Unassigned" placeholder site
            end
        end
        Note over API,DB: status.id "2" (former employee):<br/>DELETE if no active desk,<br/>else flag status='inactive'
    end
    API-->>FE: {matched, created, removed, flagged, skipped...}
```

Key rules baked into this route (`core-api/src/modules/hubspot/hubspot.routes.ts`):
- **Matching** tries email first, then an exact-name fallback (only against local employees with no email on file, and only when the name is unambiguous) — first with legal first+last name, then with `preferred_name`+last name, so someone recorded locally under a nickname still matches.
- **Unmatched rows with a name** are created as new employees in a placeholder `"Unassigned"` site (find-or-create) rather than guessing a real office.
- **Former employees** (`status.id === "2"`) are removed outright if they have no active desk, or left in place but flagged (`status='inactive'`) if they do — surfaced on the Floor Map as a distinct-colored desk border (`FloorMapCanvas.tsx`'s `FLAGGED_*` styling).
- Nothing is ever pushed *to* HubSpot — this integration is strictly read-only against HubDB.

### Docker / deployment

```mermaid
flowchart TB
    subgraph Compose["docker-compose.yml — one internal bridge network"]
        PG["postgres<br/>(postgres:16-alpine)"]
        API["core-api<br/>(built image, port 8090→8080)"]
        FE["frontend<br/>(dev-only, Vite hot reload, port 5174)"]
        CF["cloudflared<br/>(free Quick Tunnel)"]
        BK["backup<br/>(daily pg_dump)"]
    end
    Vol1[("pgdata volume")]
    Vol2[("uploads volume")]
    Vol3[("pgbackups volume")]

    API -->|"depends_on: healthy"| PG
    FE -->|proxies /api| API
    CF -->|"tunnel --url http://core-api:8080"| API
    BK -->|"pg_dump, daily"| PG
    PG --- Vol1
    API --- Vol2
    BK --- Vol3
```

`core-api`'s image is a 3-stage build (`core-api/Dockerfile`):
1. **`frontend-build`** — `npm install && npm run build` inside `frontend/`, producing static assets.
2. **`build`** — `npm install && npm run build` (`tsc`) inside `core-api/`, producing `dist/`.
3. **`runtime`** — production `npm install --omit=dev`, then copies in stage 2's `dist/`, stage 1's frontend build (into `dist/static`), the migration files, and `docker-entrypoint.sh`.

`docker-entrypoint.sh` runs `node-pg-migrate up` **before** starting the server — every container start is guaranteed to have an up-to-date schema. The `frontend` Compose service (hot-reload dev server) is separate from this image entirely and isn't part of what actually ships.

---

## 3. Data flow: a typical request

Most of the app follows the same shape end to end — this is a desk assignment as a concrete example, but People/Sites/Floors/Devices all follow the identical pattern.

```mermaid
sequenceDiagram
    actor User
    participant FE as React component
    participant Client as api/client.ts
    participant Auth as requireAuth hook
    participant Route as assignments.routes.ts
    participant TX as withTransaction
    participant DB as Postgres

    User->>FE: clicks "Assign" in WorkspaceDetailPanel
    FE->>Client: api.assignments.create({workspace_id, employee_id})
    Client->>Auth: POST /api/assignments (cookie: sid)
    Auth->>Auth: resolve session to user, check can_edit/is_admin
    Auth->>Route: request.user attached, forwarded
    Route->>TX: withTransaction(async client => ...)
    TX->>DB: BEGIN
    TX->>DB: INSERT workspace_assignments
    TX->>DB: UPDATE workspaces SET status='assigned'
    TX->>DB: INSERT audit_logs (via recordAudit)
    TX->>DB: COMMIT
    TX-->>Route: new assignment row
    Route-->>Client: 201 + JSON
    Client-->>FE: typed WorkspaceAssignment
    FE->>FE: update local state, re-render desk as "Assigned"
```

---

## 4. Auth & permissions

```mermaid
flowchart LR
    Login["POST /api/auth/login"] -->|bcrypt check| Session["sessions row<br/>(sha256(token) stored, raw token in cookie)"]
    Session -->|"cookie: sid"| Hook["requireAuth<br/>(runs on every /api/* request)"]
    Hook -->|"no/expired session"| R401["401"]
    Hook -->|"mutating verb + not can_edit/is_admin"| R403["403 Read-only access"]
    Hook -->|ok| Route["route handler<br/>(request.user available)"]
```

Three roles, driven by two booleans on `users` (`is_admin`, `can_edit`):

| Role | `is_admin` | `can_edit` | Can do |
|---|---|---|---|
| **Guest** | false | false | View everything; submit a Ticket Desk request (the one exception — see below) |
| **Member** | false | true | View + edit the floor map/directory; review/approve Desk Tickets |
| **Admin** | true | (implied) | Everything a member can, plus Users, Config Snapshots, HubSpot sync |

Signup is invite-only (`invites` table, admin-generated); the very first admin account is created out-of-band via `core-api/src/scripts/create-admin.ts` (see README's Getting Started).

---

## 5. Notable end-to-end flows

### 5.1 Cross-site people search

`AppContext` loads `directoryEmployees`/`directoryWorkspaces`/`directoryAssignments` for **every** site once at app load (`refreshDirectory()`), independent of whichever site/floor is currently open. Typing in the People Search box filters this app-wide list client-side; selecting a match either jumps the current view (if already on that floor) or calls `goToLocation(siteId, floorId)` to switch site/floor first, then scrolls the target desk into view.

### 5.2 HubSpot sync

Covered in §2 above — admin-triggered, one-directional (HubDB → Postgres), matches-then-merges-or-creates, with former-employee cleanup as part of the same pass.

### 5.3 Config Snapshots (save/restore)

```mermaid
flowchart TB
    Save["POST /api/config-snapshots<br/>{name}"] --> Capture["jsonb_build_object(...)<br/>one query, one JSON array per table"]
    Capture --> Slot{"< 3 snapshots?"}
    Slot -->|yes| Insert["INSERT new config_snapshots row"]
    Slot -->|no| Overwrite["UPDATE the row with<br/>oldest updated_at"]

    Restore["POST /:id/restore"] --> Delete["DELETE every layout table,<br/>child → parent order"]
    Delete --> Reinsert["INSERT ... SELECT * FROM<br/>jsonb_populate_recordset(...)<br/>parent → child order"]
    Reinsert --> Reseq["setval() each sequence<br/>to MAX(id)"]
```

Scope is deliberately the *layout/directory* tables only (§2's first group) — never `users`/`sessions` (would silently revert account access) and never `audit_logs` (plain `DELETE`, not `TRUNCATE ... CASCADE`, specifically so `audit_logs.actor_id` just goes `NULL` instead of history disappearing).

### 5.4 Ticket Desk (guest-submittable requests)

```mermaid
sequenceDiagram
    actor Guest
    actor Admin
    participant FE as TicketDeskModal
    participant API as desk-requests.routes.ts
    participant DB as Postgres

    Guest->>FE: pick office → floor → desk → person (existing or new) → submit
    FE->>API: POST /api/desk-requests
    Note over API: requireAuth's global guest-write block has<br/>one exemption: exactly this route+verb
    API->>DB: INSERT desk_requests (status='pending')
    API-->>Guest: confirmation

    Admin->>API: GET /api/desk-requests (can_edit/is_admin only)
    API-->>Admin: pending list
    Admin->>API: POST /:id/approve {final field overrides}
    API->>DB: desk already occupied?
    alt occupied
        API-->>Admin: 409 "already occupied by X"
    else free
        API->>DB: resolve/CREATE employee
        API->>DB: INSERT workspace_assignments
        API->>DB: UPDATE desk_requests SET status='approved'
        API-->>Admin: success
    end
```

Everything *except* the initial `POST /` stays behind the normal `is_admin || can_edit` check, matching every other admin-gated module (`hubspot.routes.ts`, `config-snapshots.routes.ts`).

---

## 6. Directory map

```
core-api/
  src/
    app.ts                  # Fastify setup, route registration, static serving
    server.ts                # entrypoint
    config/env.ts             # all env vars, one place
    db/                      # pool, withTransaction, recordAudit, migrations/
    middleware/               # requireAuth (global), actor (legacy x-actor-id header), error-handler
    lib/hubspot.ts            # HubDB fetch wrapper
    lib/tokens.ts              # session/reset-token generation + hashing
    modules/<name>/<name>.routes.ts   # one per entity, registered at /api/<name>
    scripts/create-admin.ts     # one-off first-admin bootstrap

frontend/
  src/
    api/client.ts             # every backend call, typed
    context/                  # AuthContext, AppContext
    pages/                    # one per route
    components/               # FloorMap/*, People/*, Sidebar, TopBar
    types.ts                  # shared TS interfaces mirroring API responses

docs/
  PROJECT_PLAN.md            # original design rationale + staged roadmap
  ARCHITECTURE.md            # this document
```

---

## 7. Conventions worth knowing before changing anything

- **Every mutating route**: `withTransaction` + `recordAudit`, in that order, same transaction. Look at any existing `*.routes.ts` file before writing a new one — they're all shaped the same way.
- **Admin-gated modules** (`hubspot`, `config-snapshots`, and most of `desk-requests`) check `is_admin`/`can_edit` **inside the route** (or a plugin-scoped `onRequest` hook), because the global `requireAuth` hook only blocks *mutating* verbs for non-editors — a `GET` needs its own explicit gate if it shouldn't be guest-readable.
- **JSONB for external/flexible data**: `employees.hubspot_data` and `config_snapshots.data` are both JSONB rather than normalized columns — used when the shape is externally-owned (HubSpot) or deliberately whole-table (a snapshot), where a rigid schema would fight the use case.
- **Denormalized `_username` columns**: `config_snapshots.created_by_username`, `desk_requests.requested_by_username`/`reviewed_by_username` store the username alongside the `users(id)` FK. This is because `audit_logs.actor_id` actually references `employees(id)` (a stale pre-auth convention, see `middleware/actor.ts`), not `users(id)` — so tracking *which login account* did something needs its own column, and denormalizing the username means it still displays correctly if that user account is later deleted.
- **Migrations are raw SQL** (`pgm.sql(...)`), sequential timestamp-prefixed filenames, always with a matching `down()`. Applied automatically on every container start — never run manually against a running system.
