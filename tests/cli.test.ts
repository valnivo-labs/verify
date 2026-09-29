import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

test('a file that cannot be read is said so plainly, with exit code 2 and no stack trace', () => {
  const r = run('no-such-file.pdf')
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^Cannot read no-such-file\.pdf: /)
  assert.ok(!/\n\s+at /.test(r.stderr), 'no stack trace')
})

test('no file at all prints the usage, with exit code 2', () => {
  const r = run()
  assert.equal(r.status, 2)
  assert.match(r.stderr, /^usage: valnivo-verify <file\.pdf>/)
})

test('a file with no proof says so, with exit code 1', () => {
  const r = run(fileURLToPath(new URL('../package.json', import.meta.url)))
  assert.equal(r.status, 1)
  assert.match(r.stdout, /^NO PROOF/)
})

test('a signed document of a kind this checker does not know: its signatures are checked, exit 3', async () => {
  const { PROOF_FORMAT, encodeProof, fingerprint, newNonce, newSigningKey, nextLink, signEntry } = await import('../src/signing.ts')
  const { PROOF_MARKS } = await import('../src/index.ts')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const doc = { version: 1 as const, kind: 'test.flat-share', proposerName: 'Ana', counterpartyName: 'Ben', content: { rent: 'split' }, nonce: newNonce() }
  const print = await fingerprint(doc)
  const [a, b] = [await newSigningKey(), await newSigningKey()]
  const entries: Awaited<ReturnType<typeof signEntry>>[] = []
  for (const [act, role] of [['proposed', 'proposer'], ['signed', 'counterparty']] as const) {
    entries.push(await signEntry('d', { ...nextLink(entries), act, role, byUid: role, termsPrint: print, detail: '' }, role === 'proposer' ? a : b))
  }
  const path = join(mkdtempSync(join(tmpdir(), 'verify-')), 'flat-share.pdf')
  writeFileSync(path, `%PDF-1.4\n%${PROOF_MARKS.valnivo}${encodeProof({ format: PROOF_FORMAT, documentId: 'd', document: doc, entries })}\n%%EOF\n`)
  const r = run(path)
  assert.equal(r.status, 3)
  assert.match(r.stdout, /^SIGNATURES HOLD/)
  assert.match(r.stdout, /Kind: +test\.flat-share/)
})

test('an issued document: issued with the list that holds its key, exit 0; changed, exit 1; unknown issuer, exit 1', async () => {
  const { ISSUED_VERSION, encodeIssued, newNonce, signIssued } = await import('../src/signing.ts')
  const { issuedLine } = await import('../src/index.ts')
  const { createHash, webcrypto } = await import('node:crypto')
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey)
  const body = Buffer.from('An attestation, issued as a test.\n')
  const doc = {
    version: ISSUED_VERSION, kind: 'labs.document', issuer: 'valnivo-labs', issuedAt: '2026-09-29T18:00:00Z',
    content: { sha256: createHash('sha256').update(body).digest('hex'), name: 'note.txt', mediaType: 'text/plain' }, nonce: newNonce(),
  }
  const proof = await signIssued(doc, 'cli-1', pair.privateKey)
  const dir = mkdtempSync(join(tmpdir(), 'verify-cli-'))
  const file = join(dir, 'note.txt')
  writeFileSync(file, Buffer.concat([body, Buffer.from(`${issuedLine(encodeIssued(proof))}\n`)]))
  const list = join(dir, 'issuers.json')
  writeFileSync(list, JSON.stringify([{ issuer: 'valnivo-labs', name: 'Valnivo Labs', keyId: 'cli-1', publicKey: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, validFrom: '2026-01-01T00:00:00Z', validUntil: null, revokedAt: null }]))
  const ok = run(file, '--issuers', list)
  assert.equal(ok.status, 0, ok.stdout + ok.stderr)
  assert.match(ok.stdout, /^ISSUED by Valnivo Labs/)
  assert.equal(run(file).status, 1, 'a key this copy does not pin')
  const changed = join(dir, 'changed.txt')
  writeFileSync(changed, Buffer.concat([Buffer.from('An attestation, changed.\n'), Buffer.from(`${issuedLine(encodeIssued(proof))}\n`)]))
  const bad = run(changed, '--issuers', list)
  assert.equal(bad.status, 1)
  assert.match(bad.stdout, /changed after it was issued/)
})
