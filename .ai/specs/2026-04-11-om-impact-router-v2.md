# om-impact-router v2: Fact-Gatherer Script + LLM Judgment

## TLDR
**Key Points:**
- Refactor the om-impact-router skill to split deterministic fact-gathering (TypeScript script) from intent classification (LLM agent), eliminating 5 review bugs caused by keyword-based strategy heuristics
- Establish om-impact-router as the single source of truth consumed by downstream skills (spec-writing, pre-implement-spec, implement-spec, code-review)

**Scope:**
- Strip `impact_map.ts` to a pure fact-gatherer (~250 lines, down from 561)
- Move strategy determination, implication inference, and naive miss generation to SKILL.md LLM instructions
- Fix spec surfacing to recurse into nested directories
- Document the skill architecture and cross-skill integration for all future development

**Concerns:**
- Downstream skill wiring (implement-spec, pre-implement-spec, etc.) is out of scope for this spec — tracked as future work

---

## Overview

The **om-impact-router** skill is a pre-spec blast radius analyzer for Open Mercato. It answers three questions before any spec writing or coding begins:

1. **What does this change touch?** — modules, entities, ACL, API routes, migrations, downstream consumers
2. **What strategy?** — system-extension, module-scaffold, or eject-and-customize
3. **What context to load?** — exact AGENTS.md paths and skills for the chosen path

The skill uses a **hybrid architecture**: a deterministic TypeScript script scans the filesystem for facts (module signals, downstream references, relevant specs), then an LLM agent applies judgment (strategy determination, implication inference, risk identification) using a decision table.

### Current State (v1 — implemented)

The initial implementation exists on branch `feat/om-impact-router` with the following files:

| File | Status | Purpose |
|------|--------|---------|
| `SKILL.md` | Implemented | Agent instructions — run script, apply decision table, emit 4-section report |
| `scripts/impact_map.ts` | Implemented (561 lines) | Deterministic scanner + keyword-based strategy/implication classification |
| `references/strategy-router-rules.md` | Implemented | Decision table mapping signals to strategies |
| `references/context-routing-map.md` | Implemented | Module-to-AGENTS.md path mapping |
| `scripts/fixtures/sample_input_*.md` | Implemented (4 files) | Test fixtures for base_price, acl_only, eject, new_module scenarios |

**v1 problems identified through 2 Codex review rounds (5 findings):**

All 5 findings target the script's classification layer — the parts where it tries to do LLM reasoning with keyword heuristics:

| ID | Severity | Finding | Root Cause |
|----|----------|---------|------------|
| P1-1 | P2 | `isNewDomain` routes existing-module work to scaffold | Keyword "new entity" too broad — matches inside existing module context |
| P1-2 | P2 | `migrationLikely` false for true new-domain requests | Guard `primaryModules.some(m => m.hasEntities)` fails when no module exists yet |
| P2-1 | P2 | Eject blockers skipped when `isStrongNewDomain` fires first | Cascading if-else priority conflict — mixed signals not handled |
| P2-2 | P2 | Spec surfacing misses 71% of specs in nested dirs | `findRelevantSpecs()` only scans top-level `.ai/specs/` |
| P2-3 | P3 | Backend pages signal collected but never used in naive misses | `hasBackendPages` added to `scanModule()` but not to `buildNaiveMisses()` |

Zero findings target filesystem scanning (`scanModule`, `findDownstreamModules`, `identifyCandidateModules`).

## Problem Statement

### 1. The script is doing two fundamentally different things

**Filesystem fact-gathering** (works, zero bugs): module directory scanning, downstream detection, spec surfacing. These are cheap, deterministic, exhaustive operations (~1s) that an LLM cannot reliably replicate without being told exactly which 16 files to check across N modules.

**Intent classification** (keeps breaking): strategy selection via keyword matching, implication derivation via keyword+signal gating, naive miss generation via conditional lists. This is exactly what LLMs handle naturally — reading natural language, weighing ambiguous signals, applying a decision table with nuance.

Each fix to the keyword heuristics introduces new edge cases. The strong/weak keyword split (P1-1 fix) introduced the priority ordering bug (P2-1). This is a whack-a-mole pattern inherent to the approach.

### 2. No downstream skill consumes the output

The om-impact-router was designed as the pipeline entry point, but three major downstream skills independently re-discover the same information:

| Skill | What it re-discovers | How |
|---|---|---|
| **implement-spec** | Strategy choice (extension/scaffold/eject) | "Extension Mode Decision" user prompt |
| **pre-implement-spec** | BC surfaces, downstream modules | Subagent code scanning |
| **code-review** | Frozen contract surface violations | Manual heuristic scan per changed file |

None reference or import om-impact-router's output.

## Proposed Solution

### Design Decision: Hybrid Split

| Decision | Rationale |
|----------|-----------|
| Keep deterministic script for fact-gathering | LLMs can't exhaustively check 16 files across 15+ modules in ~1s without hallucination risk |
| Move all classification to LLM | 5/5 bugs are in classification; LLMs handle mixed signals, ambiguity, and nuance naturally |
| Output JSON only from script | LLM produces the markdown report with full context awareness |
| Declare output as authoritative for downstream skills | Prevents re-discovery and ensures consistency |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Pure LLM (no script) | LLM would need to run 50+ file-existence checks via glob/read (~10-20s). Risk of missing signals due to hallucination or incomplete enumeration. The script does this exhaustively in ~1s. |
| Keep classification in script, add more keywords | Each keyword fix introduces new edge cases (proven by 2 review rounds). The keyword lists also need manual maintenance as the platform evolves. Fundamentally wrong tool for the job. |
| Replace script with a static JSON manifest | Requires manual updates when modules change. The script discovers current state dynamically. |

---

## Architecture

### Data Flow

```
 Input (issue text, feature description, diff, or module hint)
                    │
                    ▼
 ┌──────────────────────────────────────────┐
 │         impact_map.ts (script)           │
 │         ~250 lines, JSON output          │
 │                                          │
 │  identifyCandidateModules(issueText)     │
 │         │                                │
 │         ▼                                │
 │  scanModule(repo, moduleId)              │
 │    → 16 file-existence checks per module │
 │         │                                │
 │         ▼                                │
 │  findDownstreamModules(repo, primaryIds) │
 │    → grep AGENTS.md cross-references     │
 │         │                                │
 │         ▼                                │
 │  findRelevantSpecs(repo, moduleIds)      │
 │    → recursive .ai/specs/ traversal      │
 │         │                                │
 │         ▼                                │
 │  stdout: FactReport JSON                 │
 └──────────────────────────────────────────┘
                    │
                    ▼
 ┌──────────────────────────────────────────┐
 │         LLM Agent (SKILL.md)             │
 │                                          │
 │  1. Parse FactReport JSON                │
 │  2. Read strategy-router-rules.md        │
 │  3. Apply decision table to signals      │
 │     + issue text (strategy)              │
 │  4. Infer implications from signals      │
 │     + issue text                         │
 │  5. Generate naive misses from signals   │
 │  6. Build context package via            │
 │     context-routing-map.md               │
 │  7. Emit 4-section report + naive misses │
 └──────────────────────────────────────────┘
                    │
                    ▼
              Impact Report
       (consumed by downstream skills)
```

### Script Boundary: What is deterministic vs. what is judgment

| Function | Category | In script? | Why |
|----------|----------|------------|-----|
| `identifyCandidateModules()` | Fact | Yes | Keyword→module ID lookup from a static map |
| `scanModule()` | Fact | Yes | 16 file-existence checks — deterministic, exhaustive |
| `findDownstreamModules()` | Fact | Yes | Grep AGENTS.md for cross-module references |
| `findRelevantSpecs()` | Fact | Yes | Recursive dir traversal + keyword match in filenames/headers |
| Strategy determination | Judgment | No → LLM | Requires understanding issue intent, resolving ambiguous/mixed signals |
| Implication inference | Judgment | No → LLM | Requires reasoning about what the change implies for migration, ACL, API |
| Naive miss generation | Judgment | No → LLM | Requires risk assessment based on signals + change context |
| Report rendering | Presentation | No → LLM | LLM produces markdown with full context |

---

## Data Models

### FactReport (script output)

```typescript
interface FactReport {
  /** Modules found in packages/core/src/modules/ matching the issue */
  primaryModules: ModuleSignals[]
  /** Other modules whose AGENTS.md references a primary module */
  downstreamModules: DownstreamRef[]
  /** Spec files matching affected module keywords */
  relevantSpecs: string[]
  /** Raw module IDs identified from issue text (including unresolved ones) */
  candidateIds: string[]
}
```

### ModuleSignals (unchanged from v1)

```typescript
interface ModuleSignals {
  moduleId: string
  path: string                   // e.g. "packages/core/src/modules/catalog"
  hasEntities: boolean           // data/entities.ts
  hasAcl: boolean                // acl.ts
  hasApi: boolean                // api/
  hasMigrations: boolean         // migrations/
  hasEnrichers: boolean          // data/enrichers.ts
  hasExtensions: boolean         // data/extensions.ts
  hasWorkers: boolean            // workers/
  hasSubscribers: boolean        // subscribers/
  hasWidgetInjection: boolean    // widgets/injection-table.ts
  hasComponentOverrides: boolean // widgets/components.ts
  hasFrontendPages: boolean      // frontend/
  hasBackendPages: boolean       // backend/
  hasNotifications: boolean      // notifications.ts
  hasNotificationRenderers: boolean // notifications.client.ts
}
```

### DownstreamRef (unchanged from v1)

```typescript
interface DownstreamRef {
  moduleId: string
  reason: string  // e.g. "sales/AGENTS.md references 'catalog'"
}
```

### MODULE_KEYWORDS map (unchanged from v1)

```typescript
const MODULE_KEYWORDS: Record<string, string[]> = {
  catalog: ['catalog', 'product', 'products', 'category', 'categories', 'variant', 'variants', 'pricing', 'price', 'prices', 'offer', 'offers', 'option schema'],
  sales: ['sales', 'order', 'orders', 'quote', 'quotes', 'invoice', 'invoices', 'shipment', 'shipments', 'payment', 'payments', 'line item', 'document flow'],
  customers: ['customer', 'customers', 'person', 'people', 'company', 'companies', 'deal', 'deals', 'contact', 'contacts', 'crm'],
  auth: ['auth', 'authentication', 'user', 'users', 'role', 'roles', 'permission', 'permissions', 'login', 'session', 'rbac'],
  customer_accounts: ['customer account', 'customer portal', 'portal login', 'customer login', 'customer signup', 'magic link'],
  currencies: ['currency', 'currencies', 'exchange rate', 'multi-currency', 'fx'],
  workflows: ['workflow', 'workflows', 'automation', 'step', 'activity', 'saga', 'compensation'],
  integrations: ['integration', 'integrations', 'marketplace', 'provider', 'bundle', 'credentials'],
  data_sync: ['sync', 'data sync', 'adapter', 'mapping', 'import', 'export'],
  audit_logs: ['audit', 'audit log', 'audit trail', 'history'],
  attachments: ['attachment', 'attachments', 'file upload', 'document upload'],
  notifications: ['notification', 'notifications', 'alert', 'alerts'],
  search: ['search', 'fulltext', 'indexing', 'reindex'],
  staff: ['staff', 'employee', 'team member'],
  dictionaries: ['dictionary', 'dictionaries', 'lookup', 'enum'],
  configs: ['config', 'configs', 'configuration', 'settings'],
}
```

---

## LLM Agent Instructions (SKILL.md design)

The refactored SKILL.md must instruct the LLM agent to perform the following after receiving the script's `FactReport`:

### Strategy Determination

The LLM reads the issue text + `FactReport` + `strategy-router-rules.md` decision table and applies this logic:

1. **Check eject blockers FIRST** — if the issue describes changing core behaviour in `lib/` or `services/`, modifying frozen contract surfaces, or altering calculation/pipeline logic → `eject-and-customize` regardless of other signals
2. **Check for new domain** — if no primary module exists AND issue describes a new bounded domain with its own entities → `module-scaffold`
3. **Check for strong new domain with existing module matches** — if issue explicitly says "new module", "standalone", "separate module", "create a module" AND the keyword matches are incidental context → `module-scaffold` (but only if no eject blockers)
4. **Check for additive change** — if primary module exists AND change adds fields/routes/enrichers/widgets without touching core logic → `system-extension`
5. **Otherwise** → `uncertain` with specific questions to resolve ambiguity

Critical rule: **eject blockers always win over scaffold signals.** "Create a new standalone pricing module by changing how the catalog pricing service resolves prices" → eject, not scaffold.

### Implication Inference

The LLM infers from signals + issue text:

| Implication | Condition |
|---|---|
| Migration likely | Issue mentions new fields/entities/columns AND (module has `hasEntities: true` OR no module exists yet — new entities need new tables) |
| ACL touchpoint | Issue mentions permissions/access/restrict AND module has `hasAcl: true` |
| API route change | Issue mentions API/endpoint/route AND module has `hasApi: true` |
| Enricher affected | Downstream modules exist OR module has `hasEnrichers: true` |

### Naive Miss Generation

The LLM identifies top 3-5 risks a naive agent would skip:

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

### Report Rendering

The LLM produces exactly 4 sections + naive misses callout (format unchanged from v1 SKILL.md).

---

## Cross-Skill Integration

### Pipeline Position

```
 om-impact-router ──▶ spec-writing ──▶ pre-implement-spec ──▶ implement-spec ──▶ code-review
     (this spec)       consumes:        consumes:              consumes:          consumes:
                       context package  module signals         strategy           BC surface list
                       relevant specs   downstream list        context package    naive misses
```

### Authoritative Output Contract

The impact report is the **single source of truth** for:
- Which modules are affected (do not re-scan)
- What strategy to use (do not re-prompt the user)
- What AGENTS.md files to load (do not manually browse Task Router)
- What BC surfaces are at risk (do not re-discover via code scanning)

### Future Downstream Wiring (out of scope)

These changes are NOT part of this spec but are documented as the next logical step:

| Skill | Current (duplicated) | Target (consumes impact report) |
|---|---|---|
| `implement-spec` | "Extension Mode Decision" step asks user to manually choose extension/scaffold/eject | Load impact report strategy; skip the manual prompt |
| `pre-implement-spec` | Dispatches subagents to scan code for BC surfaces | Start from impact report's `primaryModules` signals + `downstreamModules` |
| `spec-writing` | Tells user to manually browse root AGENTS.md Task Router | Load impact report's context package directly |
| `code-review` | Manually scans every changed file against BC rules | Use impact report's frozen surface list as checklist baseline |

---

## Implementation Plan

### Phase 1: Strip Script to Fact-Gatherer

**Goal:** Remove all classification logic from `impact_map.ts`, output JSON-only `FactReport`.

#### Step 1: Remove classification functions and their dependencies

From `impact_map.ts`, delete:
- `determineStrategy()` function (lines ~206-285)
- `deriveImplications()` function (lines ~468-504)
- `buildNaiveMisses()` function (lines ~290-316)
- `renderMarkdown()` function (lines ~322-416)
- All keyword lists used only by these functions: `coreChangeKeywords`, `frozenSurfaceKeywords`, `libServiceKeywords`, `additiveKeywords`, `strongNewDomainKeywords`, `weakNewDomainKeywords`, `migrationKeywords`, `aclKeywords`, `apiKeywords`
- The `ImpactReport` interface (replace with `FactReport`)

#### Step 2: Remove the `--format` CLI flag

- Remove `format` from `parseArgs()` return type and argument parsing
- Script always outputs JSON via `JSON.stringify(factReport, null, 2)`

#### Step 3: Simplify `main()` to fact-gathering only

```typescript
async function main() {
  const { input, repo, moduleHint } = parseArgs()

  const candidateIds = identifyCandidateModules(input, moduleHint)

  const primaryModules: ModuleSignals[] = []
  for (const id of candidateIds) {
    const signals = scanModule(repo, id)
    if (signals) primaryModules.push(signals)
  }

  const downstreamModules = findDownstreamModules(repo, candidateIds)
  const relevantSpecs = findRelevantSpecs(repo, candidateIds, input)

  const report: FactReport = {
    primaryModules,
    downstreamModules,
    relevantSpecs,
    candidateIds,
  }

  console.log(JSON.stringify(report, null, 2))
}
```

#### Step 4: Fix `findRelevantSpecs()` recursion

Replace flat `readdirSync(absDir).filter(...)` with recursive traversal. Walk all subdirectories under `.ai/specs/` and `.ai/specs/enterprise/`. Exclude `README.md`, `AGENTS.md`, `CLAUDE.md`, `LICENSE.md`.

#### Step 5: Verify against fixtures

Run script against all 4 fixtures and verify:
1. JSON output contains `primaryModules`, `downstreamModules`, `relevantSpecs`, `candidateIds`
2. No `strategy`, `implications`, or `naiveAgentMisses` fields in output
3. `sample_input_new_module.md` — `relevantSpecs` includes specs from nested dirs if any match customer/loyalty keywords
4. All fixtures produce valid JSON with exit code 0

### Phase 2: Update SKILL.md with LLM Judgment Instructions

**Goal:** Add explicit strategy determination, implication inference, naive miss generation, and report rendering instructions to SKILL.md.

#### Step 1: Rewrite "How to Produce the Report" section

Replace the current 4-step process with:
1. Run script → parse `FactReport` JSON
2. Read `references/strategy-router-rules.md`
3. Determine strategy (with explicit priority: eject blockers > scaffold > system-extension > uncertain)
4. Infer implications from signals + issue text
5. Generate naive misses from signal checklist
6. Build context package via `references/context-routing-map.md`
7. Emit 4-section report + naive misses callout

#### Step 2: Add strategy determination instructions

Include the priority-ordered logic from the "LLM Agent Instructions" section of this spec. Emphasize: **eject blockers always win over scaffold signals.**

#### Step 3: Add implication inference table

Include the condition table from the "Implication Inference" section of this spec.

#### Step 4: Add naive miss generation checklist

Include the signal-to-miss mapping table from the "Naive Miss Generation" section of this spec.

#### Step 5: Add authoritative output declaration

Add a section declaring that the impact report is the single source of truth for downstream skills and should not be re-discovered.

#### Step 6: Test the full skill flow

Invoke the skill against each fixture and verify:
1. LLM correctly determines strategy for each scenario
2. Implications match expected values
3. Naive misses cover backend pages (P2-3 fix), downstream modules, ACL, migrations
4. Context package includes correct AGENTS.md paths

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.ai/skills/om-impact-router/scripts/impact_map.ts` | Modify | Strip to ~250-line fact-gatherer: remove `determineStrategy`, `deriveImplications`, `buildNaiveMisses`, `renderMarkdown`, all classification keywords. Fix `findRelevantSpecs` recursion. JSON-only output. |
| `.ai/skills/om-impact-router/SKILL.md` | Modify | Add strategy determination priority logic, implication inference table, naive miss checklist, authoritative output declaration. Update "How to Produce the Report" section. |
| `.ai/skills/om-impact-router/references/strategy-router-rules.md` | No change | Decision table consumed by LLM — already correct |
| `.ai/skills/om-impact-router/references/context-routing-map.md` | No change | Module-to-AGENTS.md mapping — already correct |
| `.ai/skills/om-impact-router/scripts/fixtures/sample_input_*.md` | No change | Test fixtures remain valid as inputs |

---

## Risks & Impact Review

### Script Removal Regression
- **Scenario**: Removing classification functions might accidentally delete shared code needed by fact-gathering functions
- **Severity**: Low
- **Affected area**: `impact_map.ts` — script may fail to run
- **Mitigation**: The classification functions (`determineStrategy`, `deriveImplications`, `buildNaiveMisses`, `renderMarkdown`) are self-contained and do not share code with fact-gathering functions. The `ImpactReport` type is the only shared dependency — replace with `FactReport`.
- **Residual risk**: None — verify with fixture tests after removal

### LLM Strategy Drift
- **Scenario**: Without deterministic strategy output, different LLM invocations might produce different strategies for the same input
- **Severity**: Medium
- **Affected area**: Strategy consistency across sessions
- **Mitigation**: SKILL.md provides explicit priority-ordered decision logic with the decision table from `strategy-router-rules.md`. The LLM has more context than the keyword heuristics and can reason about ambiguity rather than guessing wrong.
- **Residual risk**: Minor variance in edge cases is acceptable — the LLM can explain its reasoning and flag uncertainty, which keyword heuristics cannot do

### Spec Surfacing Performance
- **Scenario**: Recursive traversal of `.ai/specs/` might be slow with 186+ files
- **Severity**: Low
- **Affected area**: Script execution time
- **Mitigation**: File existence checks and directory traversal are I/O-bounded but fast on local filesystem. Even with 186 files, reading first 20 lines of each is <1s.
- **Residual risk**: None at current scale

### Downstream Skills Not Updated
- **Scenario**: Downstream skills continue to re-discover information instead of consuming the impact report
- **Severity**: Medium (workflow inefficiency, not correctness issue)
- **Affected area**: implement-spec, pre-implement-spec, spec-writing, code-review
- **Mitigation**: This spec documents the intended integration. Downstream wiring is tracked as future work. The skills will still function correctly — they just do redundant work.
- **Residual risk**: Accepted — downstream wiring is a separate PR

---

## Changelog

### 2026-04-11
- Initial specification
- Documents v1 current state, 5 review findings, and refactor direction
- Defines fact-gatherer script boundary, LLM judgment instructions, and cross-skill integration
- Implementation plan: Phase 1 (strip script) + Phase 2 (update SKILL.md)
