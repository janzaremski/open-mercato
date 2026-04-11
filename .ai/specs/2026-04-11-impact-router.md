# impact-router: Hybrid Fact-Gathering + LLM Judgment

## TLDR
**Key Points:**
- The impact-router skill uses a hybrid architecture: a deterministic TypeScript script scans the filesystem for facts, then an LLM agent applies judgment for strategy determination and report rendering
- The script (~250 lines) outputs a `FactReport` JSON; all classification, implication inference, and risk assessment lives in SKILL.md instructions
- The impact report is the single source of truth for affected modules and strategy, and a starting point for context loading and risk signals

**Scope:**
- `impact_map.ts` — pure fact-gatherer (module signals, downstream refs, relevant specs)
- `SKILL.md` — LLM judgment instructions (strategy, implications, naive misses, report rendering)
- `references/` — decision table and context routing map consumed by the LLM
- Phase 3 (pending): wire downstream skills to consume the impact report

---

## Overview

The **impact-router** skill is a pre-spec blast radius analyzer for Open Mercato. It answers three questions before any spec writing or coding begins:

1. **What does this change touch?** — modules, entities, ACL, API routes, migrations, downstream consumers
2. **What strategy?** — system-extension, module-scaffold, or eject-and-customize
3. **What context to load?** — exact AGENTS.md paths and skills for the chosen path

## Design Rationale

### Why a hybrid architecture?

**Filesystem fact-gathering** requires checking 16 files per module across 15+ modules, grepping AGENTS.md for cross-references, and recursively traversing `.ai/specs/`. These are cheap, deterministic, exhaustive operations (~1s) that an LLM cannot reliably replicate without hallucination risk.

**Strategy determination and risk assessment** require understanding natural language intent, weighing ambiguous signals, and applying a decision table with nuance. This is exactly what LLMs handle naturally.

Keeping these concerns in a single script creates a whack-a-mole pattern where keyword heuristic fixes introduce new edge cases. The hybrid split eliminates this by assigning each concern to the right tool.

### Alternatives considered

| Alternative | Why Rejected |
|-------------|-------------|
| Pure LLM (no script) | Would need 50+ file-existence checks via glob/read (~10-20s). Risk of missing signals due to hallucination or incomplete enumeration. |
| All-in-script (keyword heuristics for classification) | Each keyword fix introduces new edge cases. Keyword lists need manual maintenance as the platform evolves. Wrong tool for the job. |
| Static JSON manifest | Requires manual updates when modules change. The script discovers current state dynamically. |

---

## Architecture

### Data Flow

```
 Input (issue text, feature description, diff, or module hint)
                    |
                    v
 +------------------------------------------+
 |         impact_map.ts (script)           |
 |         ~250 lines, JSON output          |
 |                                          |
 |  identifyCandidateModules(issueText)     |
 |         |                                |
 |         v                                |
 |  scanModule(repo, moduleId)              |
 |    -> 14 boolean + 2 string signals      |
 |         |                                |
 |         v                                |
 |  findDownstreamModules(repo, primaryIds) |
 |    -> grep AGENTS.md cross-references    |
 |         |                                |
 |         v                                |
 |  findRelevantSpecs(repo, moduleIds)      |
 |    -> recursive .ai/specs/ traversal     |
 |         |                                |
 |         v                                |
 |  stdout: FactReport JSON                 |
 +------------------------------------------+
                    |
                    v
 +------------------------------------------+
 |         LLM Agent (SKILL.md)             |
 |                                          |
 |  1. Parse FactReport JSON                |
 |  2. Determine strategy via               |
 |     strategy-router-rules.md             |
 |  3. Infer implications from signals      |
 |     + issue text                         |
 |  4. Generate naive misses from signals   |
 |  5. Build context package via            |
 |     context-routing-map.md               |
 |  6. Emit 4-section report + naive misses |
 +------------------------------------------+
                    |
                    v
              Impact Report
       (consumed by downstream skills)
```

### Script Boundary

| Function | Category | In script? | Why |
|----------|----------|------------|-----|
| `identifyCandidateModules()` | Fact | Yes | Keyword-to-module ID lookup from a static map |
| `scanModule()` | Fact | Yes | File-existence checks per module — deterministic, exhaustive |
| `findDownstreamModules()` | Fact | Yes | Grep AGENTS.md for cross-module references |
| `findRelevantSpecs()` | Fact | Yes | Recursive dir traversal + keyword match in filenames/headers |
| Strategy determination | Judgment | No -> LLM | Requires understanding issue intent, resolving ambiguous/mixed signals |
| Implication inference | Judgment | No -> LLM | Requires reasoning about what the change implies for migration, ACL, API |
| Naive miss generation | Judgment | No -> LLM | Requires risk assessment based on signals + change context |
| Report rendering | Presentation | No -> LLM | LLM produces markdown with full context |

---

## Data Models

The script's TypeScript interfaces (`FactReport`, `ModuleSignals`, `DownstreamRef`) and the `MODULE_KEYWORDS` map are defined in `.ai/skills/impact-router/scripts/impact_map.ts` — that file is the source of truth. Key points:

- **`FactReport`** — top-level output: `primaryModules`, `downstreamModules`, `relevantSpecs`, `candidateIds`
- **`ModuleSignals`** — per-module: `moduleId`, `path`, and 14 boolean file-existence signals (entities, ACL, API, migrations, enrichers, extensions, workers, subscribers, widget injection, component overrides, frontend/backend pages, notifications, notification renderers)
- **`DownstreamRef`** — `moduleId` + `reason` (which AGENTS.md reference was found)
- **`MODULE_KEYWORDS`** — maps 16 module IDs to keyword arrays for candidate identification

---

## LLM Agent Instructions

The SKILL.md instructs the LLM agent to perform the following after receiving the script's `FactReport`:

### Strategy Determination

The LLM reads the issue text + `FactReport` + `strategy-router-rules.md` decision table and applies this priority-ordered logic:

1. **Check eject blockers FIRST** — if the issue describes changing core behaviour in `lib/` or `services/`, modifying frozen contract surfaces, or altering calculation/pipeline logic -> `eject-and-customize` regardless of other signals
2. **Check for new domain** — if no primary module exists AND issue describes a new bounded domain with its own entities -> `module-scaffold`
3. **Check for strong new domain with existing module matches** — if issue explicitly says "new module", "standalone", "separate module", "create a module" AND the keyword matches are incidental context -> `module-scaffold` (but only if no eject blockers)
4. **Check for additive change** — if primary module exists AND change adds fields/routes/enrichers/widgets without touching core logic -> `system-extension`
5. **Otherwise** -> `uncertain` with specific questions to resolve ambiguity

Critical rule: **eject blockers always win over scaffold signals.** "Create a new standalone pricing module by changing how the catalog pricing service resolves prices" -> eject, not scaffold.

### Implication Inference

| Implication | Condition |
|---|---|
| Migration likely | Issue mentions new fields/entities/columns AND (module has `hasEntities: true` OR no module exists yet) |
| ACL touchpoint | Issue mentions permissions/access/restrict AND module has `hasAcl: true` |
| API route change | Issue mentions API/endpoint/route AND module has `hasApi: true` |
| Enricher affected | Downstream modules exist OR module has `hasEnrichers: true` |

### Naive Miss Generation

Top 3-5 risks a naive agent would skip:

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

### Report Output

The LLM produces exactly 4 sections + naive misses callout: Impact Summary, Strategy Decision, Context Package, Next Action.

---

## Cross-Skill Integration

### Pipeline Position

```
 impact-router --> spec-writing --> pre-implement-spec --> implement-spec --> code-review
                      consumes:        consumes:              consumes:          consumes:
                      context package  module signals         strategy           module list
                      relevant specs   downstream list        context package    risk signals
```

### Authoritative Output Contract

The impact report is the **single source of truth** for:
- Which modules are affected (do not re-scan)
- What strategy to use (do not re-prompt the user)

The report also provides a **starting point** (not exhaustive) for:
- **Context package** — lists root, core, and module-level AGENTS.md paths. Downstream skills should still consult `references/context-routing-map.md` for package-level guides (`packages/search/AGENTS.md`, `packages/ui/AGENTS.md`, etc.) based on detected concerns.
- **Risk signals** — infers migration, ACL, API, and enricher implications. Downstream skills (`pre-implement-spec`, `code-review`) must still perform their own BC surface scanning for frozen contract surfaces (event IDs, widget spots, import paths, CLI commands) that the report does not enumerate.

### Downstream Skill Wiring (Phase 3)

Four downstream skills independently re-discover information that the impact report already provides:

| Skill | Current (duplicated) | Target (consumes impact report) |
|---|---|---|
| `implement-spec` | "Extension Mode Decision" asks user to manually choose strategy | Check for impact report; if present, load strategy and skip the manual prompt |
| `pre-implement-spec` | Dispatches subagents to scan code for BC surfaces from scratch | Seed from impact report's `primaryModules` + `downstreamModules`; still perform own BC scanning |
| `spec-writing` | Tells user to manually browse root AGENTS.md Task Router | Load context package from impact report as starting point |
| `code-review` | Manually scans every changed file against BC rules | Use module list and risk signals as checklist seed; still scan for frozen surfaces |

---

## Implementation Plan

### Phase 1: Fact-Gatherer Script (Done)

**Goal:** `impact_map.ts` outputs JSON-only `FactReport` with no classification logic.

**What the script does:**
1. `parseArgs()` — parse `--input` and `--repo` CLI flags
2. `identifyCandidateModules()` — match issue text against `MODULE_KEYWORDS` map
3. `scanModule()` — 14 boolean + 2 string file-existence checks per module
4. `findDownstreamModules()` — grep other modules' AGENTS.md for primary module references
5. `findRelevantSpecs()` — recursive traversal of `.ai/specs/` with keyword matching on filenames and first 20 lines
6. Output `FactReport` JSON to stdout

### Phase 2: SKILL.md LLM Judgment Instructions (Done)

**Goal:** SKILL.md contains explicit instructions for strategy determination, implication inference, naive miss generation, and report rendering.

**What SKILL.md instructs:**
1. Run script -> parse `FactReport` JSON
2. Determine strategy using `strategy-router-rules.md` with priority-ordered logic (eject > scaffold > extension > uncertain)
3. Infer implications by cross-referencing signals with issue text
4. Generate naive misses from signal checklist
5. Build context package via `context-routing-map.md`
6. Emit 4-section report + naive misses callout

### Phase 3: Downstream Skill Wiring (Not Started)

**Goal:** Wire four downstream skills to consume the impact report instead of independently re-discovering module signals and strategy.

**Design principle:** The impact report is authoritative for module identification and strategy. It is a *starting point* for context loading and risk signals — downstream skills still perform their own BC surface scanning and consult `context-routing-map.md` for package-level guides.

#### Step 1: Wire `implement-spec`

In `.ai/skills/implement-spec/SKILL.md` (and the om-superpowers variant), modify the **Extension Mode Decision** section:

- Before asking the user to choose extension/scaffold/eject, check whether an impact report was produced earlier in the conversation
- If an impact report exists with a non-`uncertain` strategy, use it directly and skip the manual prompt
- If strategy is `uncertain`, still ask the user but present the impact report's signals as context
- Add a note: "If no impact report exists, proceed with the current manual decision flow"

#### Step 2: Wire `pre-implement-spec`

In `.ai/skills/pre-implement-spec/SKILL.md` (and the om-superpowers variant):

- In the initial scanning phase, check for an existing impact report
- If present, seed the BC analysis with `primaryModules` signals and `downstreamModules` instead of dispatching fresh subagents to discover them
- Still perform independent BC surface scanning — the impact report does not enumerate frozen contract surfaces
- Add `candidateIds` that didn't resolve to `primaryModules` as potential new-module signals

#### Step 3: Wire `spec-writing`

In `.ai/skills/spec-writing/SKILL.md` (and the om-superpowers variant):

- In the context-loading phase, check for an existing impact report
- If present, load the context package (module AGENTS.md paths, relevant specs) directly as a starting point
- Still consult `context-routing-map.md` for package-level guides based on detected concerns (UI, search, events, etc.)
- If no impact report exists, proceed with the current "browse Task Router" flow

#### Step 4: Wire `code-review`

In `.ai/skills/code-review/SKILL.md` (and the om-superpowers variant):

- In the review preparation phase, check for an existing impact report
- If present, use the module list and risk signals (migration, ACL, API, enricher) as a checklist seed to prioritize review sections
- Still scan changed files independently for frozen contract surface violations — the impact report does not provide an exhaustive BC surface list
- Use `downstreamModules` to flag cross-module enricher/query breakage risks

#### Step 5: Verify end-to-end flow

Test the full pipeline with a sample feature request:
1. Run impact-router -> produces report
2. Run spec-writing -> verify it picks up context package without manual browsing
3. Run pre-implement-spec -> verify it seeds from impact report signals
4. Run implement-spec -> verify it skips Extension Mode Decision when strategy is present
5. Run code-review -> verify it uses module list as review seed

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.ai/skills/impact-router/scripts/impact_map.ts` | Done (Phase 1) | ~250-line fact-gatherer, JSON-only output |
| `.ai/skills/impact-router/SKILL.md` | Done (Phase 2) | Strategy determination, implication inference, naive miss checklist, authoritative output contract |
| `.ai/skills/impact-router/references/strategy-router-rules.md` | No change | Decision table consumed by LLM |
| `.ai/skills/impact-router/references/context-routing-map.md` | No change | Module-to-AGENTS.md mapping |
| `.ai/skills/impact-router/scripts/fixtures/sample_input_*.md` | No change | 4 test fixtures (base_price, acl_only, eject, new_module) |
| `.ai/skills/implement-spec/SKILL.md` | Phase 3 | Check for impact report before Extension Mode Decision |
| `.ai/skills/pre-implement-spec/SKILL.md` | Phase 3 | Seed BC analysis from impact report signals |
| `.ai/skills/spec-writing/SKILL.md` | Phase 3 | Load context package from impact report |
| `.ai/skills/code-review/SKILL.md` | Phase 3 | Use impact report as review checklist seed |

---

## Risks & Impact Review

### LLM Strategy Drift
- **Scenario**: Different LLM invocations might produce different strategies for the same input
- **Severity**: Medium
- **Affected area**: Strategy consistency across sessions
- **Mitigation**: SKILL.md provides explicit priority-ordered decision logic with the decision table from `strategy-router-rules.md`. The LLM can reason about ambiguity and flag uncertainty rather than guessing wrong.
- **Residual risk**: Minor variance in edge cases is acceptable — the LLM explains its reasoning, which is better than silent misclassification

### Spec Surfacing Noise
- **Scenario**: Broad keywords (e.g. "product", "order") match many specs, producing a noisy `relevantSpecs` list
- **Severity**: Low
- **Affected area**: Context loading efficiency
- **Mitigation**: The LLM filters the list intelligently when building the context package. The script provides exhaustive matches; the LLM selects the most pertinent ones.
- **Residual risk**: Accepted — future improvement could weight filename matches higher than content matches

### Downstream Skills Not Yet Wired
- **Scenario**: Downstream skills continue to re-discover information instead of consuming the impact report
- **Severity**: Medium (workflow inefficiency, not correctness issue)
- **Affected area**: implement-spec, pre-implement-spec, spec-writing, code-review
- **Mitigation**: Phase 3 documents the intended integration. The skills function correctly without it — they just do redundant work.
- **Residual risk**: Accepted — Phase 3 is tracked

---

## Implementation Status

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| Phase 1 — Fact-Gatherer Script | Done | 2026-04-11 | 4 fixtures passing, JSON-only output |
| Phase 2 — SKILL.md LLM Judgment | Done | 2026-04-11 | 6-step process, full skill flow verified |
| Phase 3 — Downstream Skill Wiring | Not Started | — | 5 steps across 4 downstream skills |

---

## Changelog

### 2026-04-11
- Initial specification and implementation of Phases 1-2
- Script stripped to ~250-line fact-gatherer with recursive spec traversal
- SKILL.md updated with priority-ordered strategy logic, implication inference, naive miss checklist
- Authoritative output contract: single source of truth for modules/strategy, starting point for context/risk
- Phase 3 defined for downstream skill wiring (implement-spec, pre-implement-spec, spec-writing, code-review)
