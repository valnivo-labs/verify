#!/usr/bin/env node
/**
 * valnivo-verify <file> [--json] [--of <file>] [--issuers <list.json>]
 *
 * Checks that a document signed in a Valnivo Labs product — by two people, or
 * issued by Valnivo Labs or a product — is authentic, with nothing but the
 * file, and asks nobody anything.
 *
 * `--of` is the file a timestamp is of. `--issuers` is a copy of the published
 * key list (`ISSUERS_URL`, which this command never fetches), which knows of a
 * withdrawn key where the list pinned into this version cannot.
 *
 * Exit 0 when it holds (or is issued); 3 when its signatures and history hold
 * but it is of a kind whose own rules this checker does not know; 1 when it
 * does not hold or carries no proof; 2 on a usage error or a file that cannot
 * be read.
 */
import { readFileSync } from 'node:fs'
import { ISSUED_LIMIT, KNOWN_KINDS, WITHOUT_THE_RECORD, checkFile, type IssuerKey } from './index.ts'

const args = process.argv.slice(2)
const json = args.includes('--json')
const valueOf = (name: string) => {
  const at = args.indexOf(`--${name}`)
  return at >= 0 ? args[at + 1] : undefined
}
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--of' && args[i - 1] !== '--issuers')
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

const readOrExit = (path: string) => {
  try {
    return new Uint8Array(readFileSync(path))
  } catch (e) {
    console.error(`Cannot read ${path}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`)
    process.exit(2)
  }
}
const of = valueOf('of')
const issuersFile = valueOf('issuers')
const options = {
  ...(of ? { subject: readOrExit(of) } : {}),
  ...(issuersFile ? { issuers: JSON.parse(new TextDecoder().decode(readOrExit(issuersFile))) as IssuerKey[] } : {}),
}

const result = await checkFile(bytes, undefined, options)
if (json) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.outcome === 'holds' || result.outcome === 'issued' ? 0 : result.outcome === 'unknown-kind' && result.signaturesHold ? 3 : 1)
}

if ('issued' in result) {
  const doc = result.issued.document
  const by = result.issuer?.name ?? doc?.issuer
  const said: Record<string, string> = {
    issued: `ISSUED by ${by}`,
    'other-file': `OTHER FILE: the timestamp is ${by}'s, but of other bytes than ${of}`,
    'unknown-issuer': `UNKNOWN ISSUER: no key this checker holds signed it${issuersFile ? '' : ' (pass --issuers with the published list if this copy may be old)'}`,
    'key-revoked': `NOT AUTHENTIC: dated after ${by} withdrew the key that signed it`,
    'outside-key-validity': `NOT AUTHENTIC: dated outside the life of the ${by} key that signed it`,
    'not-authentic': result.problems.includes('file-changed') ? `NOT AUTHENTIC: the file carries ${by}'s signature but was changed after it was issued` : 'NOT AUTHENTIC',
  }
  console.log(said[result.outcome])
  if (result.outcome === 'issued') console.log(ISSUED_LIMIT)
  else if (result.problems.length) console.log(`What did not hold: ${result.problems.join(', ')}`)
  console.log('')
  console.log(`Kind:          ${doc?.kind}`)
  console.log(`Issuer:        ${by}, key ${result.issued.keyId}`)
  console.log(`Issued at:     ${doc?.issuedAt}`)
  const c = (doc?.content ?? {}) as { sha256?: string; name?: string; mediaType?: string; title?: string }
  if (c.title) console.log(`Title:         ${c.title}`)
  if (c.name) console.log(`File:          ${c.name} (${c.mediaType})`)
  if (c.sha256) console.log(`SHA-256:       ${c.sha256}`)
  process.exit(result.outcome === 'issued' ? 0 : 1)
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
