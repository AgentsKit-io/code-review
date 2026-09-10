/** A batch plan must use the full PR source before partitioning its files. */
export function batchSourceRequested(batchIndex: string | undefined, batchSize: string | undefined): boolean {
  return batchIndex !== undefined || batchSize !== undefined
}

import { partitionReviewableFiles } from './batch-coverage.js'

/** Split only after measuring the exact invocation; a single-file failure stays blocked. */
export async function planReviewBatches(
  files: readonly string[], size: number,
  measure: (files: string[], packIds?: string[]) => Promise<{ overBudget: string[]; contextPacks?: Array<{ id: string }> }>,
): Promise<{ batches: Array<{ index: number; files: string[]; packIds?: string[] }>; overBudget: string[] }> {
  const batches: Array<{ index: number; files: string[]; packIds?: string[] }> = []
  const overBudget: string[] = []
  async function visit(files: string[], packIds?: string[]): Promise<void> {
    const plan = await measure(files, packIds)
    if (plan.overBudget.length && files.length > 1) {
      const middle = Math.ceil(files.length / 2)
      await visit(files.slice(0, middle))
      await visit(files.slice(middle))
      return
    }
    const packs = packIds ?? plan.contextPacks?.map((pack) => pack.id)
    if (plan.overBudget.length && files.length === 1 && packs && packs.length > 1) {
      const middle = Math.ceil(packs.length / 2)
      await visit(files, packs.slice(0, middle))
      await visit(files, packs.slice(middle))
      return
    }
    const index = batches.length
    batches.push({ index, files, ...(packIds ? { packIds } : {}) })
    overBudget.push(...plan.overBudget.map((reason) => `batch ${index} (${files.join(', ')}): ${reason}`))
  }
  for (const batch of partitionReviewableFiles(files, size)) await visit(batch.files)
  return { batches, overBudget }
}

/** Never start a publishable batch run when the source itself is incomplete. */
export function assertBatchManifestComplete(unreviewed: readonly { file: string }[]): void {
  if (unreviewed.length > 0) {
    const files = unreviewed.map((item) => item.file).join(', ')
    throw new Error(`--batch-manifest requires complete source coverage; ${unreviewed.length} file(s) are unreviewed: ${files}`)
  }
}
