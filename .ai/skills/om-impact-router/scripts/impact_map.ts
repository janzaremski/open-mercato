#!/usr/bin/env npx tsx
/**
 * om-impact-router: impact_map.ts
 *
 * Deterministic fact-gatherer for Open Mercato modules.
 * Given an issue description and repo root, scans the filesystem for module
 * signals, downstream consumers, and relevant specs. Outputs a FactReport JSON
 * that the LLM agent in SKILL.md uses for strategy determination and report rendering.
 *
 * Usage:
 *   npx tsx impact_map.ts --input "Add base price field to catalog products" --repo /path/to/open-mercato
 *   npx tsx impact_map.ts --input ./fixtures/sample_input_base_price.md --repo /path/to/open-mercato
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

interface FactReport {
  primaryModules: ModuleSignals[]
  downstreamModules: DownstreamRef[]
  relevantSpecs: string[]
  candidateIds: string[]
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

function parseArgs(): { input: string; repo: string; moduleHint?: string } {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i !== -1 ? args[i + 1] : undefined
  }

  const inputArg = get('--input')
  if (!inputArg) {
    console.error('Usage: npx tsx impact_map.ts --input "<issue text or file path>" [--repo <path>] [--module <hint>]')
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

  const allModules = readdirSync(modulesPath).filter((m: string) => {
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
// Spec surfacing — recursively scan .ai/specs/ for relevant specs
// ---------------------------------------------------------------------------

function findRelevantSpecs(repoRoot: string, primaryModuleIds: string[], issueText: string): string[] {
  const specDirs = ['.ai/specs']
  const matched: string[] = []
  const excludedFiles = new Set(['README.md', 'AGENTS.md', 'CLAUDE.md', 'LICENSE.md'])

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

  function walkDir(dir: string) {
    const absDir = join(repoRoot, dir)
    if (!existsSync(absDir)) return

    const entries = readdirSync(absDir)

    for (const entry of entries) {
      const absPath = join(absDir, entry)
      const stat = statSync(absPath)

      if (stat.isDirectory()) {
        walkDir(join(dir, entry))
        continue
      }

      if (!entry.endsWith('.md') || excludedFiles.has(entry)) continue

      const fileLower = entry.toLowerCase()
      let isMatch = [...searchTerms].some(term => fileLower.includes(term.toLowerCase()))

      if (!isMatch) {
        try {
          const content = readFileSync(absPath, 'utf-8')
          const first20Lines = content.split('\n').slice(0, 20).join(' ').toLowerCase()
          isMatch = [...searchTerms].some(term => first20Lines.includes(term.toLowerCase()))
        } catch { /* skip unreadable */ }
      }

      if (isMatch) matched.push(`${dir}/${entry}`)
    }
  }

  for (const dir of specDirs) {
    walkDir(dir)
  }

  return matched
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

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

main().catch(err => {
  console.error('impact_map error:', err)
  process.exit(1)
})
