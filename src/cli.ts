#!/usr/bin/env node
/**
 * valnivo-verify <file.pdf> [--json]
 *
 * Checks a signed document with nothing but the file, and asks nobody anything.
 * Exit 0 when it holds, 1 when it does not, 2 on a usage error.
 */
import { readFileSync } from 'node:fs'
import { WITHOUT_THE_RECORD, checkFile } from './index.ts'

const args = process.argv.slice(2)
const json = args.includes('--json')
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: valnivo-verify <file.pdf> [--json]')
  process.exit(2)
}

const result = await checkFile(new Uint8Array(readFileSync(file)))
if (json) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.outcome === 'no-proof') {
  console.log('NO PROOF: this file carries no Valnivo Labs proof.')
} else if (result.outcome === 'unknown-kind') {
  console.log(`UNKNOWN KIND: a signed document of kind "${result.proof.document?.kind}", which this checker does not read.`)
} else {
  const { document, entries } = result.proof
  const content = document.content as { amountMinor?: number; currency?: string; lentOn?: string; note?: string; schedule?: { dueOn: string; amountMinor: number }[] }
  const address = (act: string) => entries.find((e) => e.act === act)?.detail || '(none recorded)'
  console.log(result.outcome === 'holds' ? 'HOLDS' : 'NOT AUTHENTIC')
  if (result.outcome === 'holds') console.log(WITHOUT_THE_RECORD)
  else console.log(`What did not hold: ${result.problems.join(', ')}`)
  console.log('')
  console.log(`Kind:         ${document.kind}`)
  console.log(`Proposed by:  ${document.proposerName}, signed in as ${address('proposed')}`)
  console.log(`Signed by:    ${document.counterpartyName}, signed in as ${address('opened')}`)
  if (content.amountMinor !== undefined) console.log(`Amount:       ${content.amountMinor} (smallest unit of ${content.currency}), lent on ${content.lentOn}`)
  for (const r of content.schedule ?? []) console.log(`  due ${r.dueOn}:  ${r.amountMinor}`)
  if (content.note) console.log(`Note:         ${content.note}`)
  console.log(`Status:       ${result.verdict.status}${result.verdict.closedAs ? ` (${result.verdict.closedAs})` : ''}`)
  console.log(`Steps:        ${entries.length}`)
  console.log(`Fingerprint:  ${result.verdict.termsPrint}`)
}
process.exit(result.outcome === 'holds' ? 0 : 1)
