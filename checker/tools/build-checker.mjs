/**
 * Builds `dist/valnivo-checker.html`: the loan checker as **one file** a person
 * saves beside their PDF, which keeps working if valnivo.eu is ever gone
 * (`docs/agreements.md` §5, `src/check/offline.ts`).
 *
 * One file, so nothing it needs can go missing: the script and the stylesheet
 * are inlined, and the page's own Content-Security-Policy allows exactly that
 * script by its hash and **no connection of any kind** (`default-src 'none'`),
 * so the browser itself refuses a request even if a line of code tried one.
 * The build refuses a bundle that names a way to reach the network, as a second
 * lock on the same door.
 *
 * Run by `npm run build` after `vite build`, before the service worker is
 * stamped, so the stamp covers it. Deterministic: the same source gives the
 * same bytes.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = process.argv[2] ?? `${root}dist/valnivo-checker.html`

const bundle = await build({
  entryPoints: [`${root}src/check/offline.ts`],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  charset: 'utf8',
})
let script = bundle.outputFiles[0].text.trim()

// A second lock: nothing in the file may name a way out.
for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'EventSource', 'import(']) {
  if (script.includes(word)) {
    console.error(`build-checker: the offline checker names ${word}; it must reach nothing`)
    process.exit(1)
  }
}
// `</script` inside a string would end the element early.
script = script.replace(/<\/script/gi, '<\\/script')

const css = readFileSync(`${root}src/check/checker.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n\s*\n/g, '\n').trim()
const hash = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
const policy = `default-src 'none'; script-src ${hash(script)}; style-src ${hash(css)}; img-src data:; base-uri 'none'; form-action 'none'`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>Check a signed loan · Valnivo (offline)</title>
<!--
  Valnivo's loan checker, as one file. It reads a loan PDF saved from Valnivo on
  this computer and sends nothing anywhere: the policy above forbids every
  connection. It checks that the terms are the ones both people signed and that
  nothing in the history was changed. It cannot check Valnivo's own record of
  the history — for that, use https://valnivo.eu/check/ while it exists.
  The proof format is written down in full (valnivo-labs-proof-v1) at
  https://github.com/valnivo-labs/verify, so the same check can be redone with
  any SHA-256 and ECDSA P-256 implementation.
-->
<style>${css}</style>
</head>
<body>
<div id="root"></div>
<noscript><p>This checker runs in your browser and needs JavaScript. It sends nothing anywhere.</p></noscript>
<script>${script}</script>
</body>
</html>
`

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html)
const sha256 = createHash('sha256').update(html, 'utf8').digest('hex')
console.log(`${out.replace(root, '')}: ${(html.length / 1024).toFixed(1)} KB, no connection allowed, sha256 ${sha256}`)

// The page that offers the file states its fingerprint, so a copy somebody hands you can be
// compared with the one this site serves. The public repository builds the same bytes from the same
// source and lists the same value on each release (`valnivo-labs/verify`).
const page = join(dirname(out), 'check', 'index.html')
if (existsSync(page)) {
  const before = readFileSync(page, 'utf8')
  const after = before.replace(/(<meta name="valnivo-checker-sha256" content=")[^"]*(")/, `$1${sha256}$2`)
  if (after === before && !before.includes(sha256)) {
    console.error(`build-checker: ${page} has no valnivo-checker-sha256 meta to fill`)
    process.exit(1)
  }
  writeFileSync(page, after)
}
