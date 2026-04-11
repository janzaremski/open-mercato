---
name: om-impact-router
description: Pre-spec impact analysis and strategy routing for Open Mercato. Run this skill when a developer has an issue, feature request, or change description and needs to know: (1) which modules and files are likely affected, (2) whether to extend an existing module, scaffold a new one, or eject and customize core behaviour, (3) which AGENTS.md files and specs to load before writing any code. Triggers on phrases like "analyze blast radius", "what modules are affected", "should this be extension or scaffold", "what context should I load", "plan this OM feature", or any time scope or module impact is unclear before spec writing or implementation begins.
---

# om-impact-router

Answer three questions before any coding or spec writing begins:

1. **What does this change touch?** — modules, entities, ACL, API routes, migrations, downstream consumers
2. **What strategy?** — system-extension, module-scaffold, or eject-and-customize
3. **What context to load?** — exact AGENTS.md paths and skills for the chosen path

## When to Run

Run after matching the task in the root AGENTS.md task router and checking `.ai/specs/` for existing specs, but **before** writing a spec or any code. Skip if the task is already fully scoped in an approved spec.

## Inputs

Accept any of:

- Plain-language issue or feature description (most common)
- A spec title or path from `.ai/specs/`
- A diff or list of changed files
- A module hint (e.g. "catalog", "sales")

## How to Produce the Report

### Step 1 — Run the fact-gathering script

```bash
npx tsx .ai/skills/om-impact-router/scripts/impact_map.ts \
  --input "<issue text or path to input file>" \
  --repo <repo root, defaults to cwd>
```

The script outputs a `FactReport` JSON containing:
- `primaryModules` — module signals (16 boolean file-existence checks per module)
- `downstreamModules` — other modules whose AGENTS.md references a primary module
- `relevantSpecs` — spec files matching affected module keywords (recursive traversal)
- `candidateIds` — raw module IDs identified from issue text

Use this JSON as the factual foundation for all subsequent steps.

If the script cannot run (environment issue), fall back to manual analysis: read the issue, identify candidate module names, check `packages/core/src/modules/<id>/` for the file signals listed in `references/strategy-router-rules.md`.

### Step 2 — Determine strategy

Read the issue text + `FactReport` + `references/strategy-router-rules.md` decision table and apply this priority-ordered logic:

1. **Check eject blockers FIRST** — if the issue describes changing core behaviour in `lib/` or `services/`, modifying frozen contract surfaces (event IDs, widget spot IDs, ACL feature IDs, API route URLs, DB schema renames), or altering calculation/pipeline logic → **`eject-and-customize`** regardless of other signals

2. **Check for new domain** — if no primary module exists (`primaryModules` is empty) AND issue describes a new bounded domain with its own entities → **`module-scaffold`**

3. **Check for strong new domain with existing module matches** — if issue explicitly says "new module", "standalone", "separate module", "create a module" AND the keyword matches are incidental context (not the target module) → **`module-scaffold`** (but only if no eject blockers from step 1)

4. **Check for additive change** — if primary module exists AND change adds fields/routes/enrichers/widgets without touching core logic → **`system-extension`**

5. **Otherwise** → **`uncertain`** with specific questions to resolve ambiguity

**Critical rule: eject blockers always win over scaffold signals.** "Create a new standalone pricing module by changing how the catalog pricing service resolves prices" → eject, not scaffold.

Do not guess — if signals are ambiguous, report the strategy as "uncertain" and list what additional information would resolve it.

### Step 3 — Infer implications

Cross-reference the `FactReport` signals with the issue text to determine:

| Implication | Condition |
|---|---|
| **Migration likely** | Issue mentions new fields/entities/columns AND (module has `hasEntities: true` OR no module exists yet — new entities need new tables) |
| **ACL touchpoint** | Issue mentions permissions/access/restrict AND module has `hasAcl: true` |
| **API route change** | Issue mentions API/endpoint/route AND module has `hasApi: true` |
| **Enricher affected** | Downstream modules exist (`downstreamModules.length > 0`) OR module has `hasEnrichers: true` |

### Step 4 — Generate naive misses

Identify the top 3-5 risks a naive agent would skip, using this signal checklist:

| Signal | Naive miss |
|---|---|
| `downstreamModules.length > 0` | Downstream modules that reference this module's data — enrichers or queries may break |
| `hasAcl: true` + new API exposure | ACL feature declaration needed in `acl.ts` |
| Migration likely | Database migration required — `yarn db:generate` before any data access |
| `hasEnrichers: true` OR downstream exists | Response enricher update — downstream modules may need updating |
| `hasWidgetInjection: true` | Widget injection table may need new entries |
| `hasBackendPages: true` | Backend/admin pages may need updating for new data |
| `hasFrontendPages: true` | Customer-facing pages may need updating |
| `hasNotifications: true` | Notification types may need a new entry |
| `hasSubscribers: true` | Event subscribers may need updating for new events |

### Step 5 — Build context package

Use `references/context-routing-map.md` to map affected modules to their AGENTS.md paths.
Always include `packages/core/AGENTS.md` when any core module is involved.

### Step 6 — Emit the report

Produce the 4-section report + naive misses callout in the format below.

## Output Format

Produce exactly four sections:

---

### 1. Impact Summary

| Area | Detail |
|------|--------|
| Primary module | `<id>` — `packages/core/src/modules/<id>/` |
| Downstream modules | `<id>` (reason: ...) |
| Entities affected | migration likely / schema stable |
| ACL touchpoints | feature IDs needed or none |
| API routes | new / modified / none |
| Migrations | required / not required |

### 2. Strategy Decision

**Recommended: `system-extension` / `module-scaffold` / `eject-and-customize`**

Reason: _one sentence grounded in file signals or BC rules_

If uncertain: state what information would resolve the ambiguity.

### 3. Context Package

Load these before writing any spec or code:

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/<primary>/AGENTS.md`
- `packages/core/src/modules/<downstream>/AGENTS.md` _(if applicable)_
- `.ai/skills/spec-writing/SKILL.md` _(if no spec exists)_
- `.ai/skills/pre-implement-spec/SKILL.md` _(if spec exists, before implementation)_
- Relevant specs from `.ai/specs/` matching affected modules

### 4. Next Action

One of:
- **Write spec** → use `spec-writing` skill with the context package above
- **Run pre-implement-spec** → existing spec needs BC and readiness audit before implementation
- **Handoff to implement-spec** → spec is approved and ready
- **Stop and confirm** → eject path requires explicit decision before proceeding

---

## Hallucination Rule

If the script cannot prove a dependency from a file signal or an AGENTS.md reference, mark it as `possible` or omit it. A conservative report is more credible than a confident wrong one.

## Naive Agent Warning

Always include a **"Naive agent likely misses"** callout listing the 3-5 highest-risk items that an agent without this report would skip. This is the clearest way to demonstrate the skill's value.

Example:
```
Naive agent likely misses:
- downstream sales enricher that reads catalog pricing data
- ACL feature declaration required for the new field
- database migration for the new column
- backend admin pages need updating for the new data
```

## Authoritative Output Contract

The impact report produced by this skill is the **single source of truth** for:
- **Which modules are affected** — do not re-scan
- **What strategy to use** — do not re-prompt the user

The report also provides a **starting point** (not exhaustive) for:
- **Context package** — lists root, core, and module-level AGENTS.md paths. Downstream skills should still consult `references/context-routing-map.md` for package-level guides (`packages/search/AGENTS.md`, `packages/ui/AGENTS.md`, etc.) based on detected concerns.
- **Risk signals** — infers migration, ACL, API, and enricher implications. Downstream skills (`pre-implement-spec`, `code-review`) must still perform their own BC surface scanning for frozen contract surfaces (event IDs, widget spots, import paths, CLI commands) that the report does not enumerate.

## References

- `references/strategy-router-rules.md` — full decision table with file-level signals
- `references/context-routing-map.md` — module → AGENTS.md path mapping from the develop task router
