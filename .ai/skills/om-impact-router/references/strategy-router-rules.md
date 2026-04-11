# Strategy Router Rules

Use this table to determine the correct implementation strategy from the signals returned by `impact_map.ts`.

## Decision Table

| Signals from script | Strategy |
|---|---|
| Primary module exists in `packages/core/src/modules/<id>/` AND change is additive (new field, new API route, new enricher, new widget) | **system-extension** |
| No existing module matches the domain AND change requires a new entity + new API surface | **module-scaffold** |
| Requires changing behaviour inside `packages/core/src/modules/<id>/` that cannot be overridden via UMES extension mechanisms | **eject-and-customize** |
| Requires changing a frozen contract surface (see BC list below) | **eject-and-customize** — stop and confirm with developer first |

## Strategy Definitions

### system-extension
Use UMES (Universal Module Extension System). Add behaviour without touching core files:
- Response enrichers (`data/enrichers.ts`) — add computed fields to existing API responses
- Widget injection — add columns, fields, filters, actions, tabs to existing UI
- API interceptors (`api/interceptors.ts`) — before/after hooks on existing routes
- Mutation guards — validate or block mutations
- Event subscribers — react to existing events
- Component replacement (`widgets/components.ts`) — wrap or replace UI components

**Key files for signals:**
- `data/entities.ts` exists → entity is in core, extension via enricher
- `acl.ts` exists → new feature ID must be declared in your extension's `acl.ts`
- `api/` exists → intercept rather than replace

### module-scaffold
Create a new module under `packages/core/src/modules/<new-id>/` (or as a workspace package).

**Key files for signals:**
- No directory at `packages/core/src/modules/<id>/` for the domain
- Issue describes a new bounded domain with its own entities, not an addition to an existing one

**Required files to scaffold:**
`index.ts`, `acl.ts`, `setup.ts`, `data/entities.ts`, `data/validators.ts`, `api/`, `backend/`

### eject-and-customize
Copy a core module into `apps/mercato/src/modules/<id>/` and modify it directly. Last resort only.

**Key files for signals:**
- Change requires modifying business logic inside `packages/core/src/modules/<id>/lib/` or `services/`
- Change requires altering a frozen contract surface (see below)
- UMES extension mechanisms cannot achieve the required behaviour

**Always stop and confirm** with the developer before recommending this path.

## Frozen Contract Surfaces (BC Rules)

Do NOT change these without a deprecation plan:

| Surface | Location | Rule |
|---|---|---|
| Auto-discovery exports | `index.ts`, `acl.ts`, `setup.ts`, `events.ts` | Frozen — rename = breaking |
| Event IDs | `events.ts` | Frozen — rename = breaking |
| Widget spot IDs | `widgets/injection-table.ts` | Frozen |
| ACL feature IDs | `acl.ts` | Frozen |
| Notification type IDs | `notifications.ts` | Frozen |
| API route URLs | `api/*/route.ts` | Cannot rename or change HTTP method |
| DB table/column names | `data/entities.ts` | Additive only — no renames, no drops |
| DI service names | `di.ts` | Frozen registry keys |
| Generated export names | `.mercato/generated/` | Frozen |

## Ambiguity Resolution

If signals are mixed (e.g., module exists but change requires touching `lib/`), report strategy as **uncertain** and ask:

- Does the change need to modify the pricing/calculation engine, or just add a field?
- Can the required behaviour be achieved by intercepting existing API routes?
- Is the core module behaviour the blocker, or just the data model?
