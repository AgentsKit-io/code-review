import { posix } from 'node:path'
import type { Category, ReviewTarget } from './agent.js'

export type RiskLevel = 'low' | 'normal' | 'high' | 'critical'
export type RiskSignalKind = 'documentation' | 'generated' | 'test' | 'security' | 'credentials' | 'migration' | 'public-contract' | 'io' | 'repository-control' | 'source'
export interface RiskSignal { kind: RiskSignalKind; file: string; reason: string }
export interface RiskAssessment { level: RiskLevel; signals: RiskSignal[]; specializedCategories: Category[] }

const documentation = /(?:(?:^|\/)(?:docs?|examples?)\/|\.(?:md|mdx|txt)$)/i
const generated = /(?:^|\/)(?:generated|dist|build)\/|\.generated\.|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/i
const testFile = /(?:^|[./_-])(?:test|tests|spec|fixtures?)(?:[./_-]|$)/i
const securityPath = /(?:^|[./_-])(?:auth|oauth|authorization|permission|rbac|acl|security|secrets?|credentials?|tokens?|vault|crypto)(?:[./_-]|$)/i
const migrationPath = /(?:^|\/)(?:migrations?|schema)\/|(?:^|[._-])migration(?:[._-]|$)|\.sql$/i
const contractPath = /(?:^|\/)(?:contracts?|openapi|api|public)\/|(?:^|[._-])(?:contract|schema|openapi|proto)(?:[._-]|$)|\.d\.ts$/i
const repositoryControl = /^(?:package\.json|Dockerfile|Containerfile|Makefile)|^\.github\/(?:workflows|actions)\//i
const credentialContent = /(?:api[_-]?key|client[_-]?secret|private[_-]?key|password|credential|process\.env\.[A-Z0-9_]*(?:TOKEN|SECRET|KEY))/i
const securityContent = /(?:authorize|authorization|permission|rbac|acl|authenticate|oauth|can[A-Z][A-Za-z]+|hasRole)/
const ioContent = /(?:\bfetch\s*\(|\bexec(?:File)?\s*\(|\bspawn\s*\(|\breadFile|\bwriteFile|\bquery\s*\(|\btransaction\s*\(|\b(?:http|socket|database)\b)/i
const publicContractContent = /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:interface|type|class|function|enum)\b/

export function classifyContextPack(targets: readonly ReviewTarget[]): RiskAssessment {
  const signals: RiskSignal[] = []
  const add = (kind: RiskSignalKind, target: ReviewTarget, reason: string) => {
    const file = posix.normalize(target.file)
    if (!signals.some((signal) => signal.kind === kind && signal.file === file)) signals.push({ kind, file, reason })
  }
  for (const target of targets) {
    const file = posix.normalize(target.file)
    const lowCost = documentation.test(file) || generated.test(file)
    if (documentation.test(file)) add('documentation', target, 'documentation path or format')
    if (generated.test(file)) add('generated', target, 'generated or lockfile path')
    if (testFile.test(file)) add('test', target, 'test or fixture path')
    if (!lowCost && securityPath.test(file)) add('security', target, 'security-sensitive path')
    if (!lowCost && migrationPath.test(file)) add('migration', target, 'migration or database schema path')
    if (!lowCost && contractPath.test(file)) add('public-contract', target, 'public contract path or declaration format')
    if (repositoryControl.test(file)) add('repository-control', target, 'repository execution or distribution control')
    if (!lowCost && credentialContent.test(target.fullContent)) add('credentials', target, 'credential-handling code')
    if (!lowCost && securityContent.test(target.fullContent)) add('security', target, 'authorization or authentication behavior')
    if (!lowCost && ioContent.test(target.fullContent)) add('io', target, 'network, process, filesystem, or database IO')
    if (!lowCost && publicContractContent.test(target.fullContent)) add('public-contract', target, 'exported public declaration')
    if (!signals.some((signal) => signal.file === file)) add('source', target, 'ordinary source change')
  }
  const kinds = new Set(signals.map((signal) => signal.kind))
  const critical = ['security', 'credentials', 'migration'].some((kind) => kinds.has(kind as RiskSignalKind))
  const high = ['public-contract', 'io', 'repository-control'].some((kind) => kinds.has(kind as RiskSignalKind))
  const low = signals.length > 0 && signals.every((signal) => signal.kind === 'documentation' || signal.kind === 'generated')
  const level: RiskLevel = critical ? 'critical' : high ? 'high' : low ? 'low' : 'normal'
  const specializedCategories: Category[] = level === 'critical'
    ? ['correctness', 'security']
    : level === 'high'
      ? ['correctness']
      : []
  return { level, signals, specializedCategories }
}
