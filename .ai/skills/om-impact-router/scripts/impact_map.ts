#!/usr/bin/env npx tsx
/**
 * om-impact-router: impact_map.ts
 *
 * Deterministic signal scanner for Open Mercato modules.
 * Given an issue description and repo root, identifies affected modules,
 * file-level signals, downstream consumers, and recommended strategy.
 *
 * Usage:
 *   npx tsx impact_map.ts --input "Add base price field to catalog products" --repo /path/to/open-mercato
 *   npx tsx impact_map.ts --input ./fixtures/sample_input_base_price.md --repo /path/to/open-mercato --format json
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ModuleSignals {
  moduleId: string
  path: string
  hasEntities: boolean
  hasAcl: boolean
  hasApi: boolean
  hasMigrations: boolean
  hasEnrichers: boolean
  hasExtensions: boolean
  hasWorkers: boolean
  hasSubscribers: boolean
  hasWidgetInjection: boolean
  hasComponentOverrides: boolean
  hasFrontendPages: boolean
  hasBackendPages: boolean
  hasNotifications: boolean
  hasNotificationRenderers: boolean
}

interface DownstreamRef {
  moduleId: string
  reason: string
}

interface ImpactReport {
  primaryModules: ModuleSignals[]
  downstreamModules: DownstreamRef[]
  implications: {
    migrationLikely: boolean
    aclTouchpoint: boolean
    apiRouteChange: boolean
    enricherAffected: boolean
  }
  strategy: 'system-extension' | 'module-scaffold' | 'eject-and-customize' | 'uncertain'
  strategyReason: string
  naiveAgentMisses: string[]
  relevantSpecs: string[]
}

// ---------------------------------------------------------------------------
// Module keyword map — maps common terms to known module IDs
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { input: string; repo: string; format: 'json' | 'markdown'; moduleHint?: string } {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const inputArg = get('--input')
  if (!inputArg) {
    console.error('Usage: npx tsx impact_map.ts --input "<issue text or file path>" [--repo <path>] [--module <hint>] [--format json|markdown]')
    process.exit(1)
  }

  // If input looks like a file path, read it
  let input = inputArg
  if (existsSync(inputArg)) {
    input = readFileSync(inputArg, 'utf-8')
  }

  return {
    input,
    repo: resolve(get('--repo') ?? process.cwd()),
    format: (get('--format') as 'json' | 'markdown') ?? 'markdown',
    moduleHint: get('--module'),
  }
}

// ---------------------------------------------------------------------------
// Module identification
// ---------------------------------------------------------------------------

function identifyCandidateModules(issueText: string, hint?: string): string[] {
  const lower = issueText.toLowerCase()
  const candidates = new Set<string>()

  if (hint) candidates.add(hint.toLowerCase())

  for (const [moduleId, keywords] of Object.entries(MODULE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      candidates.add(moduleId)
    }
  }

  return [...candidates]
}

// ---------------------------------------------------------------------------
// Module directory scanning
// ---------------------------------------------------------------------------

function scanModule(repoRoot: string, moduleId: string): ModuleSignals | null {
  const modulePath = join(repoRoot, 'packages/core/src/modules', moduleId)
  if (!existsSync(modulePath)) return null

  const has = (rel: string) => existsSync(join(modulePath, rel))

  return {
    moduleId,
    path: `packages/core/src/modules/${moduleId}`,
    hasEntities: has('data/entities.ts'),
    hasAcl: has('acl.ts'),
    hasApi: has('api'),
    hasMigrations: has('migrations'),
    hasEnrichers: has('data/enrichers.ts'),
    hasExtensions: has('data/extensions.ts'),
    hasWorkers: has('workers'),
    hasSubscribers: has('subscribers'),
    hasWidgetInjection: has('widgets/injection-table.ts'),
    hasComponentOverrides: has('widgets/components.ts'),
    hasFrontendPages: has('frontend'),
    hasBackendPages: has('backend'),
    hasNotifications: has('notifications.ts'),
    hasNotificationRenderers: has('notifications.client.ts'),
  }
}

// ---------------------------------------------------------------------------
// Downstream detection — grep other modules' AGENTS.md for primary module names
// ---------------------------------------------------------------------------

function findDownstreamModules(repoRoot: string, primaryModules: string[]): DownstreamRef[] {
  const modulesPath = join(repoRoot, 'packages/core/src/modules')
  if (!existsSync(modulesPath)) return []

  const allModules = readdirSync(modulesPath).filter(m => {
    const p = join(modulesPath, m)
    return statSync(p).isDirectory() && !primaryModules.includes(m)
  })

  const downstream: DownstreamRef[] = []

  for (const mod of allModules) {
    const agentsPath = join(modulesPath, mod, 'AGENTS.md')
    if (!existsSync(agentsPath)) continue

    const content = readFileSync(agentsPath, 'utf-8')
    const contentLower = content.toLowerCase()

    for (const primary of primaryModules) {
      const searchTerms = [primary, primary.replace('_', ' '), ...(MODULE_KEYWORDS[primary] ?? []).slice(0, 3)]
      const matched = searchTerms.find(term => contentLower.includes(term.toLowerCase()))

      if (matched) {
        downstream.push({
          moduleId: mod,
          reason: `${mod}/AGENTS.md references "${matched}"`,
        })
        break // one match per module is enough
      }
    }
  }

  return downstream
}

// ---------------------------------------------------------------------------
// Strategy determination
// ---------------------------------------------------------------------------

function determineStrategy(
  primary: ModuleSignals[],
  issueText: string,
): { strategy: ImpactReport['strategy']; reason: string } {
  const lower = issueText.toLowerCase()

  // Signals that suggest deep core modification
  const coreChangeKeywords = ['change behavior', 'modify core', 'override calculation', 'replace service', 'change how', 'rewrite']
  const isCoreChange = coreChangeKeywords.some(kw => lower.includes(kw))

  // Signals that suggest a new domain — split into strong (explicitly a new module)
  // and weak (could be a new entity within an existing module)
  const strongNewDomainKeywords = ['new module', 'create a module', 'standalone', 'separate module']
  const weakNewDomainKeywords = ['new domain', 'new entity']
  const isStrongNewDomain = strongNewDomainKeywords.some(kw => lower.includes(kw))
  const isNewDomain = isStrongNewDomain || weakNewDomainKeywords.some(kw => lower.includes(kw))

  // Signals that suggest additive change
  const additiveKeywords = ['add field', 'add column', 'add a field', 'add a ', 'new field', 'extend', 'add to', 'expose in', 'exposed in', 'include in']
  const isAdditive = additiveKeywords.some(kw => lower.includes(kw))

  // Signals that suggest touching a frozen contract surface (BC rules)
  const frozenSurfaceKeywords = [
    'rename event', 'change event id', 'rename feature', 'remove column',
    'rename api', 'rename route', 'change http method', 'rename table',
    'drop column', 'rename column', 'remove event', 'rename widget',
    'change spot id', 'rename service', 'change di',
  ]
  const isFrozenSurface = frozenSurfaceKeywords.some(kw => lower.includes(kw))

  // Signals that suggest touching lib/ or services/ (core internals)
  const libServiceKeywords = [
    'modify service', 'change calculation', 'change pricing logic',
    'modify lib', 'change lib/', 'change services/',
    'alter service', 'modify engine', 'change engine', 'modify pipeline',
  ]
  const touchesLibOrServices = libServiceKeywords.some(kw => lower.includes(kw))

  if (primary.length === 0) {
    if (isNewDomain) {
      return { strategy: 'module-scaffold', reason: 'No existing module matches the domain and issue describes a new bounded entity' }
    }
    return { strategy: 'uncertain', reason: 'No matching module found — clarify which domain this change belongs to' }
  }

  if (isStrongNewDomain) {
    return {
      strategy: 'module-scaffold',
      reason: 'Issue explicitly describes a new standalone module — existing module keyword matches are likely related context, not the target module',
    }
  }

  if (isCoreChange) {
    return {
      strategy: 'eject-and-customize',
      reason: 'Issue describes changing core behaviour that UMES extension mechanisms cannot override — stop and confirm before proceeding',
    }
  }

  if (isFrozenSurface) {
    return {
      strategy: 'eject-and-customize',
      reason: 'Issue describes changes to a frozen contract surface (BC rule) — stop and confirm with developer',
    }
  }

  if (touchesLibOrServices) {
    return {
      strategy: 'eject-and-customize',
      reason: `Issue implies modifying core business logic in lib/ or services/ of "${primary[0]?.moduleId}" — UMES extensions cannot override this`,
    }
  }

  if (isAdditive) {
    return {
      strategy: 'system-extension',
      reason: `Change is additive (new field/API/enricher) on existing module "${primary[0]?.moduleId}" — use UMES extension mechanisms`,
    }
  }

  return { strategy: 'uncertain', reason: 'Primary module exists but change intent is ambiguous — review strategy-router-rules.md with the specific file signals' }
}

// ---------------------------------------------------------------------------
// Naive agent misses — highest-risk items a naive agent would skip
// ---------------------------------------------------------------------------

function buildNaiveMisses(primary: ModuleSignals[], downstream: DownstreamRef[], implications: ImpactReport['implications']): string[] {
  const misses: string[] = []

  if (downstream.length > 0) {
    misses.push(`downstream ${downstream.map(d => d.moduleId).join(', ')} module(s) that reference this module's data — enrichers or queries may break`)
  }
  if (implications.aclTouchpoint) {
    misses.push('ACL feature declaration — new fields exposed in the API require a feature ID in acl.ts')
  }
  if (implications.migrationLikely) {
    misses.push('database migration — entity schema change requires yarn db:generate before any data access')
  }
  if (implications.enricherAffected) {
    misses.push('response enricher update — downstream modules that enrich this entity\'s API response may need updating')
  }
  if (primary.some(m => m.hasWidgetInjection)) {
    misses.push('widget injection table — existing injection spots may need new entries or validation after this change')
  }
  if (primary.some(m => m.hasNotifications)) {
    misses.push('notification type declarations — module has notification types that may need a new entry or update')
  }
  if (primary.some(m => m.hasFrontendPages)) {
    misses.push('frontend pages — module has customer-facing pages that may need updating for the new data')
  }

  return misses.slice(0, 5)
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderMarkdown(report: ImpactReport, issueText: string, repoRoot: string): string {
  const lines: string[] = []

  lines.push('## Impact Report\n')

  // Section 1: Impact Summary
  lines.push('### 1. Impact Summary\n')
  lines.push('| Area | Detail |')
  lines.push('|------|--------|')

  if (report.primaryModules.length > 0) {
    for (const m of report.primaryModules) {
      lines.push(`| Primary module | \`${m.moduleId}\` — \`${m.path}\` |`)
    }
  } else {
    lines.push('| Primary module | not identified — check module hint |')
  }

  if (report.downstreamModules.length > 0) {
    for (const d of report.downstreamModules) {
      lines.push(`| Downstream module | \`${d.moduleId}\` (${d.reason}) |`)
    }
  } else {
    lines.push('| Downstream modules | none detected |')
  }

  lines.push(`| Entities affected | ${report.implications.migrationLikely ? 'migration likely' : 'schema appears stable'} |`)
  lines.push(`| ACL touchpoints | ${report.implications.aclTouchpoint ? 'feature ID declaration needed' : 'none detected'} |`)
  lines.push(`| API routes | ${report.implications.apiRouteChange ? 'new or modified routes' : 'none detected'} |`)
  lines.push(`| Migrations | ${report.implications.migrationLikely ? 'required — run yarn db:generate' : 'not required'} |`)
  lines.push('')

  // Section 2: Strategy
  lines.push('### 2. Strategy Decision\n')
  lines.push(`**Recommended: \`${report.strategy}\`**\n`)
  lines.push(`Reason: ${report.strategyReason}\n`)

  // Section 3: Context Package
  lines.push('### 3. Context Package\n')
  lines.push('Load these before writing any spec or code:\n')
  lines.push('- `AGENTS.md` (root)')
  lines.push('- `packages/core/AGENTS.md`')
  for (const m of report.primaryModules) {
    const agentsPath = join(repoRoot, 'packages/core/src/modules', m.moduleId, 'AGENTS.md')
    if (existsSync(agentsPath)) {
      lines.push(`- \`packages/core/src/modules/${m.moduleId}/AGENTS.md\``)
    }
  }
  for (const d of report.downstreamModules) {
    const agentsPath = join(repoRoot, 'packages/core/src/modules', d.moduleId, 'AGENTS.md')
    if (existsSync(agentsPath)) {
      lines.push(`- \`packages/core/src/modules/${d.moduleId}/AGENTS.md\``)
    }
  }

  if (report.strategy === 'system-extension') {
    lines.push('- `packages/core/AGENTS.md` → Extensions, Response Enrichers, Widget Injection sections')
  } else if (report.strategy === 'module-scaffold') {
    lines.push('- `packages/core/AGENTS.md` → Module Development, Module Setup, Events, Access Control sections')
  }

  lines.push('- `.ai/skills/spec-writing/SKILL.md` _(if no spec exists)_')
  lines.push('- `.ai/skills/pre-implement-spec/SKILL.md` _(if spec exists)_')

  if (report.relevantSpecs.length > 0) {
    lines.push('')
    lines.push('**Relevant specs:**')
    for (const spec of report.relevantSpecs) {
      lines.push(`- \`${spec}\``)
    }
  }
  lines.push('')

  // Section 4: Next Action
  lines.push('### 4. Next Action\n')
  if (report.strategy === 'eject-and-customize') {
    lines.push('**Stop and confirm** — eject path requires explicit developer decision before proceeding.')
  } else if (report.strategy === 'uncertain') {
    lines.push('**Clarify scope** — resolve the ambiguity noted in the strategy section, then re-run.')
  } else {
    lines.push('**Write spec** → use `spec-writing` skill with the context package above loaded.')
  }
  lines.push('')

  // Naive misses
  if (report.naiveAgentMisses.length > 0) {
    lines.push('---\n')
    lines.push('**Naive agent likely misses:**\n')
    for (const miss of report.naiveAgentMisses) {
      lines.push(`- ${miss}`)
    }
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Spec surfacing — scan .ai/specs/ for relevant specs by module keywords
// ---------------------------------------------------------------------------

function findRelevantSpecs(repoRoot: string, primaryModuleIds: string[], issueText: string): string[] {
  const specDirs = ['.ai/specs', '.ai/specs/enterprise']
  const matched: string[] = []

  const searchTerms = new Set<string>()
  for (const id of primaryModuleIds) {
    searchTerms.add(id)
    searchTerms.add(id.replace(/_/g, '-'))
    searchTerms.add(id.replace(/_/g, ' '))
    const kws = MODULE_KEYWORDS[id]
    if (kws) {
      for (const kw of kws.slice(0, 3)) searchTerms.add(kw)
    }
  }

  for (const dir of specDirs) {
    const absDir = join(repoRoot, dir)
    if (!existsSync(absDir)) continue

    const files = readdirSync(absDir).filter((f: string) =>
      f.endsWith('.md') && !['README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE.md'].includes(f)
    )

    for (const file of files) {
      const fileLower = file.toLowerCase()
      let isMatch = [...searchTerms].some(term => fileLower.includes(term.toLowerCase()))

      if (!isMatch) {
        try {
          const content = readFileSync(join(absDir, file), 'utf-8')
          const first20Lines = content.split('\n').slice(0, 20).join(' ').toLowerCase()
          isMatch = [...searchTerms].some(term => first20Lines.includes(term.toLowerCase()))
        } catch { /* skip unreadable */ }
      }

      if (isMatch) matched.push(`${dir}/${file}`)
    }
  }

  return matched
}

// ---------------------------------------------------------------------------
// Implication derivation — cross-references issue text with module signals
// ---------------------------------------------------------------------------

function deriveImplications(
  primaryModules: ModuleSignals[],
  downstreamModules: DownstreamRef[],
  issueText: string,
): ImpactReport['implications'] {
  const lower = issueText.toLowerCase()

  const migrationKeywords = [
    'add field', 'add column', 'new field', 'new column', 'new entity',
    'schema', 'migration', 'migrate', 'alter table', 'add table',
    'remove column', 'rename column', 'drop column', 'change type',
    'decimal', 'add property', 'stored on', 'store on',
  ]
  const migrationLikely = migrationKeywords.some(kw => lower.includes(kw))
    && (primaryModules.some(m => m.hasEntities) || primaryModules.length === 0)

  const aclKeywords = [
    'permission', 'permissions', 'acl', 'feature id', 'feature flag',
    'role', 'roles', 'access control', 'require feature', 'rbac',
    'restrict access', 'new acl feature',
  ]
  const aclTouchpoint = aclKeywords.some(kw => lower.includes(kw))
    && primaryModules.some(m => m.hasAcl)

  const apiKeywords = [
    'api', 'endpoint', 'route', 'rest', 'expose in api', 'api response',
    'api route', 'http', 'crud route', 'exposed in the api',
  ]
  const apiRouteChange = apiKeywords.some(kw => lower.includes(kw))
    && primaryModules.some(m => m.hasApi)

  // Enricher signal stays purely structural — downstream breakage is inherent risk
  const enricherAffected = downstreamModules.length > 0
    || primaryModules.some(m => m.hasEnrichers)

  return { migrationLikely, aclTouchpoint, apiRouteChange, enricherAffected }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { input, repo, format, moduleHint } = parseArgs()

  // Step 1: identify candidate modules
  const candidateIds = identifyCandidateModules(input, moduleHint)

  // Step 2: scan module directories
  const primaryModules: ModuleSignals[] = []
  for (const id of candidateIds) {
    const signals = scanModule(repo, id)
    if (signals) primaryModules.push(signals)
  }

  // Step 3: detect downstream consumers
  const downstreamModules = findDownstreamModules(repo, candidateIds)

  // Step 4: derive implications from signals AND issue text
  const implications = deriveImplications(primaryModules, downstreamModules, input)

  // Step 5: determine strategy
  const { strategy, reason: strategyReason } = determineStrategy(primaryModules, input)

  // Step 6: build naive misses
  const naiveAgentMisses = buildNaiveMisses(primaryModules, downstreamModules, implications)

  // Step 7: find relevant specs
  const relevantSpecs = findRelevantSpecs(repo, candidateIds, input)

  const report: ImpactReport = {
    primaryModules,
    downstreamModules,
    implications,
    strategy,
    strategyReason,
    naiveAgentMisses,
    relevantSpecs,
  }

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderMarkdown(report, input, repo))
  }
}

main().catch(err => {
  console.error('impact_map error:', err)
  process.exit(1)
})
