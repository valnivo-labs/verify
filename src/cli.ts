#!/usr/bin/env node
/**
 * valnivo-verify <file> [--json]
 *
 * Checks that a document signed in a Valnivo Labs product is authentic, with
 * nothing but the file, and asks nobody anything.
 *
 * Exit 0 when it holds; 3 when its signatures and history hold but it is of a
 * kind whose own rules this checker does not know; 1 when it does not hold or
 * carries no proof; 2 on a usage error or a file that cannot be read.
 */
import { readFileSync } from 'node:fs'
import { KNOWN_KINDS, WITHOUT_THE_RECORD, checkFile } from './index.ts'

const args = process.argv.slice(2)
const json = args.includes('--json')
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: valnivo-verify <file.pdf> [--json]')
  process.exit(2)
}

let bytes: Uint8Array
try {
  bytes = new Uint8Array(readFileSync(file))
} catch (e) {
  // A mistyped name is the common case: say which file and why, not a stack trace.
  console.error(`Cannot read ${file}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`)
  process.exit(2)
}

const result = await checkFile(bytes)
if (json) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.outcome === 'holds' ? 0 : result.outcome === 'unknown-kind' && result.signaturesHold ? 3 : 1)
}

if (result.outcome === 'no-proof') {
  console.log('NO PROOF: this file carries no Valnivo Labs proof.')
  process.exit(1)
}

const { document, entries } = result.proof
const address = (act: string) => {
  const detail = entries.find((e) => e.act === act)?.detail ?? ''
  return /^[^\s@]+@[^\s@]+$/.test(detail) ? `, signed in as ${detail}` : ''
}
const counterpartySigned = entries.find((e) => e.role === 'counterparty' && e.detail.includes('@'))?.act ?? 'signed'

if (result.outcome === 'unknown-kind') {
  console.log(result.signaturesHold ? 'SIGNATURES HOLD' : 'NOT AUTHENTIC')
  console.log(
    result.signaturesHold
      ? `The text is the one both people signed and every step of its history is signed and unbroken. Its kind, "${result.kind}", has rules of its own that this checker does not know (it knows: ${KNOWN_KINDS.join(', ')}).`
      : `What did not hold: ${result.problems.join(', ')}`,
  )
} else {
  console.log(result.outcome === 'holds' ? 'HOLDS' : 'NOT AUTHENTIC')
  console.log(result.outcome === 'holds' ? WITHOUT_THE_RECORD : `What did not hold: ${result.problems.join(', ')}`)
}

console.log('')
console.log(`Kind:          ${document?.kind}`)
console.log(`Proposed by:   ${document?.proposerName}${address('proposed')}`)
console.log(`Answered by:   ${document?.counterpartyName}${address(counterpartySigned)}`)

// A kind's own terms, for the kinds this checker knows how to read.
if (document?.kind === 'labs.loan') {
  const c = document.content as { amountMinor?: number; currency?: string; lentOn?: string; note?: string; schedule?: { dueOn: string; amountMinor: number }[] }
  console.log(`Amount lent:   ${c.amountMinor} (smallest unit of ${c.currency}), on ${c.lentOn}`)
  for (const r of c.schedule ?? []) console.log(`  due ${r.dueOn}:  ${r.amountMinor}`)
  if (c.note) console.log(`Note:          ${c.note}`)
}

if (result.outcome !== 'unknown-kind') {
  console.log(`Status:        ${result.verdict.status}${result.verdict.closedAs ? ` (${result.verdict.closedAs})` : ''}`)
}
console.log(`Steps:         ${entries.length}`)
console.log(`Fingerprint:   ${result.outcome === 'unknown-kind' ? result.termsPrint : result.verdict.termsPrint}`)
process.exit(result.outcome === 'holds' ? 0 : result.outcome === 'unknown-kind' && result.signaturesHold ? 3 : 1)
