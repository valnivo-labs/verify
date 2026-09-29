import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  ISSUED_CONTEXT,
  ISSUED_FORMAT,
  assembleIssued,
  decodeIssued,
  derToP1363,
  encodeIssued,
  issuedBytes,
  issuedDigest,
  issuedProblems,
  signIssued,
  type IssuedProof,
} from '../src/signing.ts'
import { ISSUED_KINDS, ISSUED_LIMIT, ISSUED_MARK, ISSUERS, TIMESTAMP_KIND, checkFile, checkIssued, issuedInFile, issuedLine, sha256OfBytes, timestampProblems, type IssuerKey } from '../src/index.ts'
import { ISSUED_VERSION, newNonce, type IssuedDocument } from '../src/signing.ts'

const spec = readFileSync(new URL('../PROOF.md', import.meta.url), 'utf8')

async function anIssuer(overrides: Partial<IssuerKey> = {}): Promise<{ key: IssuerKey; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  return {
    privateKey: pair.privateKey,
    key: { issuer: 'valnivo', name: 'Valnivo', keyId: 'test-1', publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! }, validFrom: '2026-01-01T00:00:00Z', validUntil: null, revokedAt: null, ...overrides },
  }
}

/** A timestamp document built by hand from PROOF.md §7, as any issuer would build one. */
const stampByHand = (sha256: string, issuer: string, at: Date): IssuedDocument<{ sha256: string }> => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('not a SHA-256')
  return { version: ISSUED_VERSION, kind: TIMESTAMP_KIND, issuer, issuedAt: new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z'), content: { sha256 }, nonce: newNonce() }
}

const file = new TextEncoder().encode('%PDF-1.4\nthe export\n%%EOF\n')
const when = new Date('2026-09-29T12:34:56.789Z')

async function aTimestamp(privateKey: CryptoKey, at = when): Promise<IssuedProof> {
  return signIssued(stampByHand(await sha256OfBytes(file), 'valnivo', at), 'test-1', privateKey)
}

test('a timestamp is a fingerprint, the issuer’s clock to the second, and nothing a caller can word', async () => {
  const doc = stampByHand(await sha256OfBytes(file), 'valnivo', when)
  assert.equal(doc.kind, TIMESTAMP_KIND)
  assert.equal(doc.issuedAt, '2026-09-29T12:34:56Z')
  assert.deepEqual(Object.keys(doc.content), ['sha256'])
  assert.deepEqual(issuedProblems(doc), [])
  assert.throws(() => stampByHand('not a hash', 'valnivo', when))
  assert.deepEqual(timestampProblems({ sha256: doc.content.sha256, note: 'certified true' }), ['unknown-field:note'])
  assert.deepEqual(issuedProblems({ ...doc, extra: 1 }), ['unknown-field:extra'])
  assert.ok(issuedProblems({ ...doc, issuedAt: '29/09/2026' }).includes('issued-at'))
})

test('checked against the pinned key: issued, and every way it is not', async () => {
  const { key, privateKey } = await anIssuer()
  const proof = await aTimestamp(privateKey)
  const issuers = [key]
  assert.equal((await checkIssued(proof, { issuers })).outcome, 'issued')
  assert.equal((await checkIssued(proof, { issuers, subject: file })).outcome, 'issued')
  assert.equal((await checkIssued(proof, { issuers, subject: new TextEncoder().encode('another file') })).outcome, 'other-file')
  assert.equal((await checkIssued(proof)).outcome, 'unknown-issuer', 'no real key is pinned yet')
  assert.equal((await checkIssued({ ...proof, keyId: 'test-2' }, { issuers })).outcome, 'unknown-issuer')
  assert.equal((await checkIssued({ ...proof, document: { ...proof.document, issuer: 'moien' } }, { issuers })).outcome, 'unknown-issuer', 'a key is one issuer’s alone')
  const moved = { ...proof, document: { ...proof.document, issuedAt: '2026-09-28T12:34:56Z' } }
  assert.equal((await checkIssued(moved, { issuers })).outcome, 'not-authentic', 'the time is signed')
  const other = { ...proof, document: { ...proof.document, content: { sha256: '0'.repeat(64) } } }
  assert.equal((await checkIssued(other, { issuers })).outcome, 'not-authentic', 'the fingerprint is signed')
  const { privateKey: stranger } = await anIssuer()
  assert.equal((await checkIssued(await aTimestamp(stranger), { issuers })).outcome, 'not-authentic', 'a key that is not the issuer’s')
  assert.equal((await checkIssued(proof, { issuers: [{ ...key, revokedAt: '2026-09-01T00:00:00Z' }] })).outcome, 'key-revoked')
  assert.equal((await checkIssued(proof, { issuers: [{ ...key, revokedAt: '2026-10-01T00:00:00Z' }] })).outcome, 'issued', 'dated before the withdrawal')
  assert.equal((await checkIssued(proof, { issuers: [{ ...key, validFrom: '2026-10-01T00:00:00Z' }] })).outcome, 'outside-key-validity')
  assert.equal((await checkIssued(proof, { issuers: [{ ...key, validUntil: '2026-09-01T00:00:00Z' }] })).outcome, 'outside-key-validity')
})

test('an issued kind this checker does not know: the signature is checked, the content is not', async () => {
  const { key, privateKey } = await anIssuer()
  const doc = { ...stampByHand('a'.repeat(64), 'valnivo', when), kind: 'valnivo.future-kind', content: { anything: true } }
  const found = await checkIssued(await signIssued(doc, 'test-1', privateKey), { issuers: [key] })
  assert.equal(found.outcome, 'issued')
  assert.equal(found.kindKnown, false)
  assert.deepEqual(Object.keys(ISSUED_KINDS), [TIMESTAMP_KIND, 'labs.document'])
})

test('a file carries it on its own line, and checkFile tells it from a two-party proof', async () => {
  const { key, privateKey } = await anIssuer()
  const proof = await aTimestamp(privateKey)
  const stamp = new TextEncoder().encode(`${issuedLine(encodeIssued(proof))}\n`)
  assert.deepEqual(issuedInFile(stamp), JSON.parse(JSON.stringify(proof)))
  assert.equal((await checkFile(stamp, undefined, { issuers: [key], subject: file })).outcome, 'issued')
  assert.equal((await checkFile(file)).outcome, 'no-proof')
  assert.equal(decodeIssued('garbage'), null)
})

test('a KMS signature is DER and becomes the raw r‖s this format carries', async () => {
  // Cloud KMS returns DER, as OpenSSL does: sign with node in DER, convert, check with our code.
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const key: IssuerKey = { issuer: 'valnivo', name: 'Valnivo', keyId: 'kms-1', publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x!, y: jwk.y! }, validFrom: '2026-01-01T00:00:00Z', validUntil: null, revokedAt: null }
  for (let i = 0; i < 20; i++) {
    // Twenty signatures, so some have an r or s with a leading zero byte or a high bit set.
    const doc = stampByHand(await sha256OfBytes(new TextEncoder().encode(`file ${i}`)), 'valnivo', when)
    const der = nodeSign('sha256', Buffer.from(issuedBytes(doc)), { key: privateKey, dsaEncoding: 'der' })
    const raw = derToP1363(der)
    assert.ok(raw && raw.length === 64)
    assert.equal((await checkIssued(assembleIssued(doc, 'kms-1', raw), { issuers: [key] })).outcome, 'issued', `signature ${i}`)
  }
  assert.equal(derToP1363(new Uint8Array([0x30, 0x02, 0x02, 0x00])), null)
  // What KMS is handed is the digest of the signed bytes.
  const doc = stampByHand('b'.repeat(64), 'valnivo', when)
  assert.equal(await issuedDigest(doc), createHash('sha256').update(issuedBytes(doc)).digest('hex'))
})

test('PROOF.md is enough: an issued proof checked from the file alone, with node:crypto, agrees', async () => {
  const { key, privateKey } = await anIssuer()
  const line = issuedLine(encodeIssued(await aTimestamp(privateKey)))
  const decoded = JSON.parse(Buffer.from(line.slice(`%${ISSUED_MARK}`.length), 'base64url').toString('utf8'))
  const canon = (v: unknown): string =>
    v === null || typeof v !== 'object'
      ? JSON.stringify(v)
      : Array.isArray(v)
        ? `[${v.map(canon).join(',')}]`
        : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  assert.equal(decoded.format, 'valnivo-labs-issued-v1')
  const d = decoded.document
  const bytes = Buffer.from(`Valnivo Labs issued document v1\n${canon({ version: d.version, kind: d.kind, issuer: d.issuer, issuedAt: d.issuedAt, content: d.content, nonce: d.nonce })}`, 'utf8')
  const pub = createPublicKey({ key: key.publicKey, format: 'jwk' })
  assert.ok(nodeVerify('sha256', bytes, { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(decoded.signature, 'base64url')))
  assert.equal(d.content.sha256, createHash('sha256').update(file).digest('hex'))
})

test('PROOF.md states the issued constants and what an issued document does not show', () => {
  for (const constant of [ISSUED_FORMAT, ISSUED_CONTEXT, `%${ISSUED_MARK.trim()}`, TIMESTAMP_KIND, 'valnivo-labs-issuers.json']) {
    assert.ok(spec.includes(constant), `PROOF.md does not state ${constant}`)
  }
  assert.match(spec, /issuer's own claim/)
  assert.match(spec, /not a qualified electronic seal/)
  assert.match(ISSUED_LIMIT, /own claim/)
})

test('a pinned issuer is named as identity names it, and no real key is invented', () => {
  const names: Record<string, string> = { 'valnivo-labs': 'Valnivo Labs', valnivo: 'Valnivo', moien: 'Moien', sway: 'Sway' }
  for (const k of ISSUERS) {
    assert.equal(k.name, names[k.issuer], `${k.issuer} ${k.keyId}`)
    assert.ok(!/test/i.test(k.keyId), 'a test key is never pinned')
  }
})

test('the issued wording never claims more than a signature', () => {
  const words = /\b(certified|official|legally valid|qualified seal|notari[sz]ed)\b/i
  for (const text of [ISSUED_LIMIT, spec.slice(spec.indexOf('## 7.'))]) assert.ok(!words.test(text.replace(/not a qualified electronic seal/g, '')))
})
