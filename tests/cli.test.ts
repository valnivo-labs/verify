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
