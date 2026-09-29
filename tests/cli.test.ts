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
