# om-impact-router — Gap Analysis & Next Steps

## Current State (as of 2026-04-11)

The skill has a working MVP with 5 files:

| File | Purpose | Status |
|------|---------|--------|
| `SKILL.md` | Skill definition, trigger phrases, 4-step workflow, output format | Complete |
| `references/strategy-router-rules.md` | Decision table: extension vs scaffold vs eject, frozen BC surfaces | Complete |
| `references/context-routing-map.md` | Module → AGENTS.md path mapping, skill → situation mapping | Complete |
| `scripts/impact_map.ts` | TypeScript scanner: module identification, signal scanning, downstream detection, strategy, report rendering | Complete (MVP) |
| `scripts/fixtures/sample_input_base_price.md` | Sample input for testing: catalog base_price cross-module scenario | Complete |

### What works

- Keyword-based module identification across 16 module vocabularies
- File-level signal scanning (8 signals per module: entities, ACL, API, migrations, enrichers, extensions, workers, subscribers)
- Downstream consumer detection via AGENTS.md cross-reference grep
- Strategy recommendation (system-extension / module-scaffold / eject-and-customize)
- "Naive agent likely misses" callout generation
- JSON and Markdown output formats
- CLI with `--input`, `--repo`, `--module`, `--format` flags

---

## Gap Analysis

### Gap 1: Spec Surfacing Not Wired

**Severity: High — quick win**

SKILL.md section 3 (Context Package) promises to surface relevant specs from `.ai/specs/`, but the script doesn't scan for them. During the demo, a separate agent had to find matching specs manually.

**What's missing:**
- Scan `.ai/specs/` and `.ai/specs/enterprise/` filenames and first 20 lines for module keywords
- Include matched spec paths in the JSON output under a new `relevantSpecs` field
- Render them in the Markdown Context Package section

### Gap 2: Widget / UI Signal Scanning

**Severity: Medium — quick win**

`scanModule()` checks 8 file signals but misses UI-relevant paths that indicate widget injection, component overrides, and page impact.

**Missing signals to add:**
- `widgets/injection-table.ts` → `hasWidgetInjection`
- `widgets/components.ts` → `hasComponentOverrides`
- `frontend/` directory → `hasFrontendPages`
- `backend/` directory → `hasBackendPages`
- `notifications.ts` → `hasNotifications`
- `notifications.client.ts` → `hasNotificationRenderers`

### Gap 3: Strategy Detection Based on Text, Not File Signals

**Severity: High (P1) — meaningful accuracy improvement**

`determineStrategy()` matches keywords in the issue text (e.g., "add field" → extension, "change behavior" → eject). The `strategy-router-rules.md` describes a proper file-signal-based approach that the script doesn't fully implement.

**Critical fallthrough bug (from Codex review):** At `impact_map.ts:229-232`, the condition `primary.length > 0` alone is enough to return `system-extension`. Any request mentioning an existing module that doesn't happen to include one of the handful of `coreChangeKeywords` gets routed to extension mode — even when the change requires modifying core business logic. Example: "Change sales rounding in calculations service" gets routed to `system-extension` even though `strategy-router-rules.md` says `lib/`/`services/` changes require the eject/confirm path.

**What the rules say vs what the script does:**

| Rule | Script behavior |
|------|----------------|
| "Requires changing `lib/` or `services/`" → eject | Not checked — script doesn't inspect these directories |
| "Change is additive" → extension | Inferred from keywords like "add field", not from module structure |
| "No existing module matches" → scaffold | Works correctly (checks `primaryModules.length === 0`) |
| "Frozen contract surface" → eject + stop | Not checked against actual file content |

**Fix:** After scanning modules, check whether the issue implies touching `lib/`, `services/`, or frozen contract files, and weight file-level signals above keyword matching. The default for ambiguous cases should be `uncertain`, not `system-extension`.

### Gap 4: False Implications From Module Capabilities

**Severity: High (P2) — actively misleading output**

*Identified by Codex review.* The `implications` flags (`migrationLikely`, `aclTouchpoint`, `apiRouteChange`, `enricherAffected`) at `impact_map.ts:369-373` are derived solely from whether the matched module *has* `data/entities.ts`, `api/`, or enrichers — not from whether the *requested change* touches those areas.

**Impact:** Even a non-schema change gets reported as needing migrations and API route work. Example: an ACL-only request like "Hide product prices behind a catalog feature" produces `migrationLikely: true` and `apiRouteChange: true`, making the Impact Summary and "Naive agent likely misses" sections actively misleading.

**Fix:** Implications should cross-reference issue text keywords with module signals. A module having entities doesn't mean *this change* requires a migration. Consider a two-pass approach: (1) scan module capabilities, (2) intersect with what the issue actually describes changing.

### Gap 5: Dead AGENTS.md Paths in Context Package

**Severity: Medium (P2) — sends agents to nonexistent files**

*Identified by Codex review.* The Markdown renderer at `impact_map.ts:308-310` emits `packages/core/src/modules/<id>/AGENTS.md` for every detected primary module, but many core modules do not have a module-specific AGENTS.md guide.

**Impact:** With an input like "Add attachment upload", the report includes `packages/core/src/modules/attachments/AGENTS.md` which does not exist. The next agent following this context package gets sent to a dead path, undermining the skill's promise to provide "exact AGENTS.md paths."

**Fix:** Check `existsSync()` before emitting AGENTS.md paths. Alternatively, use the `context-routing-map.md` lookup (which only lists modules that have guides) instead of blindly constructing paths from module IDs.

### Gap 6: Diff-Mode Input Not Functional (was Gap 4)

**Severity: Medium — enables code review use case**

SKILL.md says it accepts "a diff or list of changed files" as input, but the script treats all input as plain text for keyword matching. It doesn't parse file paths.

**What's needed:**
- Detect if input contains file paths (e.g., lines matching `packages/core/src/modules/<id>/`)
- Extract module IDs directly from paths
- This makes the tool useful for pre-commit or PR review scenarios

### Gap 7: Cross-Module Event Graph Tracing (was Gap 5)

**Severity: Medium — deeper analysis**

The script checks `hasSubscribers` and `hasWorkers` booleans but doesn't identify *which* events are affected or which other modules subscribe to them.

**What's needed:**
- Read `events.ts` in primary modules to extract event IDs
- Scan `subscribers/*.ts` across all modules for references to those event IDs
- Report actual event dependency chains, not just boolean flags

### Gap 8: Cross-Module Enricher Tracing (was Gap 6)

**Severity: Low-Medium**

Downstream detection greps AGENTS.md text for module name mentions. It doesn't trace actual `data/enrichers.ts` imports or `data/extensions.ts` links to find real data dependencies.

**What's needed:**
- Scan `data/enrichers.ts` files for import paths referencing primary modules
- Scan `data/extensions.ts` for `defineLink` calls pointing to primary module entities

### Gap 9: Agentic Pipeline Integration (was Gap 7)

**Severity: Low (vision item)**

The skill is standalone. The planned agentic workflow from the hackathon analysis is not wired:

```
Issue → om-impact-router → Mini-spec → Strategy decision → om-implement-spec → om-integration-tests → om-code-review
```

This is the section 4A workflow from the analysis document. Currently, the skill emits a "Next Action" recommendation but doesn't programmatically hand off to the next skill.

---

## Codex Review Findings (2026-04-11)

Independent review by Codex confirmed and sharpened several gaps, and surfaced two new ones:

| Priority | Finding | Mapped to |
|----------|---------|-----------|
| **P1** | Strategy defaults to `system-extension` for any known module — core behavior changes get misrouted | Gap 3 (enhanced) |
| **P2** | Implications derived from module capabilities, not from the actual change — false `migrationLikely`/`apiRouteChange` | **Gap 4 (new)** |
| **P2** | Context package emits AGENTS.md paths for modules that don't have guides — dead paths | **Gap 5 (new)** |
| **P2** | Relevant specs from `.ai/specs/` not included in generated context package | Gap 1 (confirmed) |

Codex verdict: *"The skill produces materially inaccurate recommendations for common inputs — it should not be considered correct yet."* Phase 1 fixes (items 1-4) address all four Codex findings.

---

## Next Steps (prioritized)

### Phase 1 — Critical fixes + quick wins (same session)

| # | Task | Gap | Effort | Impact |
|---|------|-----|--------|--------|
| 1 | **Fix strategy fallthrough**: change default from `system-extension` to `uncertain` when no additive/eject keywords match; check for `lib/`, `services/` directories | Gap 3 (P1) | ~45 min | **Critical** |
| 2 | **Fix false implications**: cross-reference issue text with module signals instead of reporting all module capabilities as affected | Gap 4 (P2) | ~30 min | High |
| 3 | **Validate AGENTS.md paths**: check `existsSync()` before emitting module guide paths in context package | Gap 5 (P2) | ~15 min | High |
| 4 | Add spec surfacing: scan `.ai/specs/` filenames for module keywords, add `relevantSpecs` to output | Gap 1 (P2) | ~30 min | High |
| 5 | Add UI signals to `scanModule()`: widget injection, components, frontend/backend pages, notifications | Gap 2 | ~20 min | Medium |
| 6 | Add more sample fixtures for testing (new module scenario, eject scenario, ACL-only scenario) | — | ~15 min | Medium |

### Phase 2 — Accuracy improvements

| # | Task | Gap | Effort | Impact |
|---|------|-----|--------|--------|
| 7 | Improve strategy detection further: frozen contract file checks, weight file signals above keywords | Gap 3 | ~1 hr | High |
| 8 | Add diff-mode parsing: detect file paths in input, extract module IDs from paths | Gap 6 | ~45 min | Medium |
| 9 | Add event graph tracing: read `events.ts`, cross-reference `subscribers/` across modules | Gap 7 | ~1 hr | Medium |

### Phase 3 — Advanced features

| # | Task | Gap | Effort | Impact |
|---|------|-----|--------|--------|
| 10 | Add enricher/extension tracing: scan `data/enrichers.ts` and `data/extensions.ts` for cross-module links | Gap 8 | ~1 hr | Low-Medium |
| 11 | Wire agentic pipeline: connect output to om-product-manager / om-cto / om-implement-spec | Gap 9 | ~2 hr | High (vision) |
| 12 | Add `--watch` mode: re-run on file changes during development | — | ~1 hr | Low |

---

## Testing the Skill

### Via CLI (script directly)
```bash
npx tsx .ai/skills/om-impact-router/scripts/impact_map.ts \
  --input .ai/skills/om-impact-router/scripts/fixtures/sample_input_base_price.md \
  --format json
```

### Via skill invocation (natural language)
Say any of:
- "analyze blast radius of [description]"
- "what modules are affected by [change]"
- "should this be extension or scaffold for [feature]"

The skill triggers, runs the script, applies strategy rules, and emits the 4-section report.
