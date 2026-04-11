# Context Routing Map

Maps detected modules and task types to the AGENTS.md files and skills that should be loaded.
Sourced directly from the develop branch root AGENTS.md task router.

## Always Load (any core module task)

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`

## Module → AGENTS.md

| Detected module | Load |
|---|---|
| `catalog` | `packages/core/src/modules/catalog/AGENTS.md` |
| `sales` | `packages/core/src/modules/sales/AGENTS.md` |
| `customers` | `packages/core/src/modules/customers/AGENTS.md` |
| `auth` | `packages/core/src/modules/auth/AGENTS.md` |
| `customer_accounts` | `packages/core/src/modules/customer_accounts/AGENTS.md` |
| `currencies` | `packages/core/src/modules/currencies/AGENTS.md` |
| `workflows` | `packages/core/src/modules/workflows/AGENTS.md` |
| `integrations` | `packages/core/src/modules/integrations/AGENTS.md` |
| `data_sync` | `packages/core/src/modules/data_sync/AGENTS.md` |

## Package → AGENTS.md

| Detected concern | Load |
|---|---|
| UI components, forms, tables, dialogs | `packages/ui/AGENTS.md` + `packages/ui/src/backend/AGENTS.md` |
| i18n, encryption, utilities | `packages/shared/AGENTS.md` |
| Search / indexing | `packages/search/AGENTS.md` |
| Background workers / queues | `packages/queue/AGENTS.md` |
| Events / SSE | `packages/events/AGENTS.md` |
| Cache | `packages/cache/AGENTS.md` |
| AI assistant / MCP tools | `packages/ai-assistant/AGENTS.md` |
| Webhooks | `packages/webhooks/AGENTS.md` |
| Onboarding | `packages/onboarding/AGENTS.md` |
| Content pages | `packages/content/AGENTS.md` |

## Skill → Load When

| Situation | Load |
|---|---|
| No spec exists yet | `.ai/skills/spec-writing/SKILL.md` |
| Spec exists, not yet implemented | `.ai/skills/pre-implement-spec/SKILL.md` |
| Spec approved, ready to implement | `.ai/skills/implement-spec/SKILL.md` |
| New integration provider | `.ai/skills/integration-builder/SKILL.md` |
| UI pages needed | `.ai/skills/backend-ui-design/SKILL.md` |
| Post-implementation review | `.ai/skills/code-review/SKILL.md` |
| Testing needed | `.ai/skills/integration-tests/SKILL.md` |
| Spec lifecycle / writing specs | `.ai/specs/AGENTS.md` |
| QA / Playwright tests | `.ai/qa/AGENTS.md` |

## Strategy → Additional Context

| Strategy | Also load |
|---|---|
| `system-extension` | `packages/core/AGENTS.md` → Extensions, Response Enrichers, Widget Injection, API Interceptors |
| `module-scaffold` | `packages/core/AGENTS.md` → Module Development, Module Setup, Events, Access Control |
| `eject-and-customize` | Module's own AGENTS.md + `packages/core/AGENTS.md` full read |

## Relevant Specs to Surface

When affected modules are detected, also surface any specs in `.ai/specs/` whose filename or title contains the module name. These give implementation history and constraints the agent must not contradict.
