import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  FINGERPRINT_CONTEXT,
  HISTORY_CONTEXT,
  PROOF_FORMAT,
  encodeProof,
  fingerprint,
  newNonce,
  newSigningKey,
  nextLink,
  signEntry,
  type Anchor,
  type HistoryEntry,
  type Json,
  type Proof,
} from '../src/signing.ts'
import { BORROWER, LENDER, loanDocument, repaymentDetail } from '../src/loan.ts'
import { KNOWN_KINDS, PROOF_MARKS, WITHOUT_THE_RECORD, checkFile, checkLoaded, proofInFile } from '../src/index.ts'

const spec = readFileSync(new URL('../PROOF.md', import.meta.url), 'utf8')

async function aLoan(): Promise<{ proof: Proof; anchor: Anchor }> {
  const document = loanDocument(
    { amountMinor: 1_000_000, currency: 'EUR', lentOn: '2026-10-01', schedule: [{ dueOn: '2027-10-01', amountMinor: 1_000_000 }], note: '' },
    { lender: 'Alice', borrower: 'Bob' },
  )
  const print = await fingerprint(document)
  const alice = await newSigningKey()
  const bob = await newSigningKey()
  const entries: HistoryEntry[] = []
  const add = async (act: string, role: 'proposer' | 'counterparty', detail = '') =>
    entries.push({ ...(await signEntry('loan-a', { ...nextLink(entries), act, role, byUid: role === LENDER ? 'alice' : 'bob', termsPrint: print, detail }, role === LENDER ? alice : bob)), at: 1_700_000_000_000 + entries.length })
  await add('proposed', LENDER, 'alice@example.com')
  await add('opened', BORROWER, 'bob@example.com')
  await add('signed', BORROWER)
  const payload = { amountMinor: 250_000, paidOn: '2026-12-01', nonce: newNonce() }
  await add('repayment', BORROWER, await repaymentDetail(payload))
  const repaid = entries[entries.length - 1].hash
  await add('confirmation', LENDER, repaid)
  const proof: Proof = { format: PROOF_FORMAT, documentId: 'loan-a', document, entries, payloads: { [repaid]: payload } }
  const anchor: Anchor = { documentId: 'loan-a', termsPrint: print, historyCount: entries.length, lastHash: entries[entries.length - 1].hash, hashes: entries.map((e) => e.hash) }
  return { proof, anchor }
}

/** A PDF-shaped file: some bytes, the proof line, some more bytes. */
const fileWith = (proof: Proof, mark = PROOF_MARKS.valnivo) =>
  new TextEncoder().encode(`%PDF-1.4\n1 0 obj << >> endobj\n%${mark}${encodeProof(proof)}\n%%EOF\n`)

test('a file is found, checked on its own, and compared with the record only when one is given', async () => {
  const { proof, anchor } = await aLoan()
  const bytes = fileWith(proof)
  assert.equal((await checkFile(bytes)).outcome, 'holds', 'offline, it holds and is never called authentic')
  assert.equal((await checkFile(bytes, async () => anchor)).outcome, 'authentic')
  assert.equal((await checkFile(bytes, async () => 'unreachable')).outcome, 'unanchored')
  assert.equal((await checkFile(bytes, async () => null)).outcome, 'not-authentic', 'never recorded')
  const older = fileWith({ ...proof, entries: proof.entries.slice(0, 3) })
  assert.equal((await checkFile(older, async () => anchor)).outcome, 'older')
  assert.equal((await checkFile(new TextEncoder().encode('%PDF-1.4\n%%EOF\n'))).outcome, 'no-proof')
  // Windows line endings after the proof line are not part of it.
  const crlf = new TextEncoder().encode(`%${PROOF_MARKS.valnivo}${encodeProof(proof)}\r\n`)
  assert.ok(proofInFile(crlf))
})

test('changing one cent, one step or one name offline is caught without the record', async () => {
  const { proof } = await aLoan()
  const more = { ...proof, document: { ...proof.document, content: { ...(proof.document.content as object), amountMinor: 1_000_001 } } as Proof['document'] }
  assert.equal((await checkLoaded(more)).outcome, 'not-authentic')
  const hash = Object.keys(proof.payloads!)[0]
  const repaidMore = { ...proof, payloads: { [hash]: { ...(proof.payloads![hash] as object), amountMinor: 250_001 } as Json } }
  assert.equal((await checkLoaded(repaidMore)).outcome, 'not-authentic')
  assert.equal((await checkLoaded({ ...proof, entries: proof.entries.filter((e) => e.act !== 'opened') })).outcome, 'not-authentic')
  const renamed = { ...proof, document: { ...proof.document, counterpartyName: 'Robert' } }
  assert.equal((await checkLoaded(renamed)).outcome, 'not-authentic')
  const other = { ...proof, document: { ...proof.document, kind: 'labs.flatshare' } }
  assert.equal((await checkLoaded(other)).outcome, 'unknown-kind')
})

test('PROOF.md is enough: the check redone from the document alone, with node:crypto, agrees', async () => {
  // Nothing from the packages below this line but the proof itself: if PROOF.md stops describing
  // what the code does, a checker written from it would disagree, and so does this.
  const { proof } = await aLoan()
  const line = new TextDecoder('latin1').decode(fileWith(proof)).split('\n').find((l) => l.startsWith('%VALNIVO-PROOF-V1 '))!
  const decoded = JSON.parse(Buffer.from(line.slice('%VALNIVO-PROOF-V1 '.length), 'base64url').toString('utf8'))
  const canon = (v: unknown): string =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(canon).join(',')}]`
        : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
  assert.equal(decoded.format, 'valnivo-labs-proof-v1')
  const d = decoded.document
  const print = sha(`Valnivo Labs signed document v1\n${canon({ version: d.version, kind: d.kind, proposerName: d.proposerName, counterpartyName: d.counterpartyName, content: d.content, nonce: d.nonce })}`)
  let prev = ''
  decoded.entries.sort((a: { seq: number }, b: { seq: number }) => a.seq - b.seq)
  decoded.entries.forEach((e: Record<string, any>, i: number) => {
    assert.equal(e.seq, i)
    assert.equal(e.termsPrint, print)
    assert.equal(e.prevHash, prev)
    const statement = `Valnivo Labs signed history v1\n${canon({ documentId: decoded.documentId, seq: e.seq, act: e.act, role: e.role, byUid: e.byUid, termsPrint: e.termsPrint, prevHash: e.prevHash, detail: e.detail })}`
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: e.publicKey.x, y: e.publicKey.y }, format: 'jwk' })
    assert.ok(nodeVerify('sha256', Buffer.from(statement, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(e.signature, 'base64url')), `signature @${i}`)
    const jwk = canon({ kty: e.publicKey.kty, crv: e.publicKey.crv, x: e.publicKey.x, y: e.publicKey.y })
    assert.equal(sha(`${statement}\n${jwk}\n${e.signature}`), e.hash, `hash @${i}`)
    if (e.act === 'repayment') {
      const p = decoded.payloads[e.hash]
      assert.equal(sha(canon({ amountMinor: p.amountMinor, paidOn: p.paidOn, nonce: p.nonce })), e.detail)
    }
    prev = e.hash
  })
})

test('the document states the constants the code uses, and what an offline check cannot show', () => {
  for (const constant of [PROOF_FORMAT, FINGERPRINT_CONTEXT, HISTORY_CONTEXT, `%${PROOF_MARKS.valnivo.trim()}`, 'IEEE P1363']) {
    assert.ok(spec.includes(constant), `PROOF.md does not state ${constant}`)
  }
  assert.match(spec, /cannot show without the product's record/)
  assert.match(spec, /not a qualified electronic signature/)
  assert.match(WITHOUT_THE_RECORD, /does not show that the history was recorded/)
})

test('the checker reaches nothing', () => {
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|indexedDB|localStorage/.test(source))
})

test('any signed document is checked, not only a loan: the shared layer holds or fails for every kind', async () => {
  // A kind no checker here knows. Everything every kind shares is still checked.
  const doc = { version: 1 as const, kind: 'test.flat-share', proposerName: 'Ana', counterpartyName: 'Ben', content: { rent: 'split in two' }, nonce: newNonce() }
  const print = await fingerprint(doc)
  const [a, b] = [await newSigningKey(), await newSigningKey()]
  const entries: HistoryEntry[] = []
  for (const [act, role] of [['proposed', 'proposer'], ['signed', 'counterparty']] as const) {
    entries.push({ ...(await signEntry('share-1', { ...nextLink(entries), act, role, byUid: role, termsPrint: print, detail: '' }, role === 'proposer' ? a : b)), at: 1 })
  }
  const proof: Proof = { format: PROOF_FORMAT, documentId: 'share-1', document: doc, entries }
  const found = await checkFile(fileWith(proof))
  assert.equal(found.outcome, 'unknown-kind')
  assert.ok(found.outcome === 'unknown-kind' && found.signaturesHold && found.kind === 'test.flat-share' && found.termsPrint === print)
  const edited = await checkLoaded({ ...proof, document: { ...doc, content: { rent: 'all mine' } } })
  assert.ok(edited.outcome === 'unknown-kind' && !edited.signaturesHold, 'a changed document of any kind is caught')
  const dropped = await checkLoaded({ ...proof, entries: [entries[1]] })
  assert.ok(dropped.outcome === 'unknown-kind' && !dropped.signaturesHold, 'a removed step of any kind is caught')
  assert.deepEqual([...KNOWN_KINDS], ['labs.loan'])
})
