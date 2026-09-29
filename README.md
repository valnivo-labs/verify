# @valnivo_labs/verify

Checks that **a document signed in a Valnivo Labs product is authentic**, with nothing but the file.

Any document two people sign carries its proof inside the file. This finds it and checks that the
text is the one both people signed, that every step of its history — proposed, signed, and whatever
followed — is signed by the key it names, and that nothing was changed, reordered or removed. It makes
no network request.

That check is the same for every kind of document. A kind can add rules of its own, and those are
checked for [the kinds listed below](#kinds-of-document); the first is Valnivo's loan between two
people, saved as a PDF from [Valnivo](https://valnivo.eu).

```bash
npx @valnivo_labs/verify document.pdf
```

```js
import { checkFile } from '@valnivo_labs/verify'

const result = await checkFile(new Uint8Array(bytes))
result.outcome // 'holds', 'not-authentic', 'no-proof' or 'unknown-kind'
```

## What "holds" means, and what it does not

**It holds**: the document is the one its signatures cover, and nothing in it has been changed.

**It does not show** that the history is the one Valnivo recorded, rather than one somebody built with
signing keys of their own — the keys are made on each person's device. Valnivo keeps a public record
of every history, and a check against it answers *authentic*: pass a reader for that record as the
second argument of `checkFile`, or use [valnivo.eu/check](https://valnivo.eu/check/).

A proof is evidence of what two accounts signed. It is **not a qualified electronic signature**, and it
does not by itself make an agreement legally binding.

## Without this code

[`PROOF.md`](https://github.com/valnivo-labs/verify/blob/main/PROOF.md) writes the format down in full — where the proof is in the file, how it is
encoded, and every hash and signature — so the same check can be redone with any SHA-256 and ECDSA
P-256 implementation. The test in `tests/` does exactly that with `node:crypto`, from the document
alone.

[`checker/valnivo-checker.html`](https://github.com/valnivo-labs/verify/blob/main/checker/valnivo-checker.html), in the repository, is the same check as one page that runs in a browser with no
connection: its own policy forbids every request.

## Official copies

Only these are Valnivo Labs's:

- [valnivo.eu/check](https://valnivo.eu/check/);
- this repository and [its releases](https://github.com/valnivo-labs/verify/releases);
- [`@valnivo_labs/verify`](https://www.npmjs.com/package/@valnivo_labs/verify) on npm, published from this repository with provenance.

Anybody may copy and change this code, and a changed copy can be made to say that any document holds.
It cannot change the document: the same file checked with an official copy, or by a checker written
from `PROOF.md`, still gives the true answer. Before relying on a `valnivo-checker.html` somebody gave
you:

- compare its SHA-256 with the one on [the latest release](https://github.com/valnivo-labs/verify/releases/latest)
  and on valnivo.eu/check — `sha256sum valnivo-checker.html`, or on Windows
  `certutil -hashfile valnivo-checker.html SHA256` — or simply choose the file on valnivo.eu/check,
  which compares it for you;
- `gh attestation verify valnivo-checker.html -R valnivo-labs/verify` shows it was built by this
  repository's release workflow.

Apache-2.0 grants no right to the Valnivo name (§6): a changed copy may not present itself as
Valnivo's.

## Building the checker

`checker/` is the offline checker's source exactly as valnivo.eu builds it, with esbuild pinned to the
same version, so `npm run build:checker` makes the same bytes. The release workflow refuses to publish
if they differ from the committed file or from what valnivo.eu serves.

## Kinds of document

Every document is checked for everything above. These kinds also have their own rules checked:

| Kind | What it is | Its own rules |
|---|---|---|
| `labs.loan` | Money one person lent another, in [Valnivo](https://valnivo.eu) | repayments and their confirmations, who may close it and with which outcome, no interest and no field beyond its own |

A document of any other kind is reported as `unknown-kind`, with `signaturesHold` saying whether
everything every kind shares holds.

## Also exported

- `@valnivo_labs/verify/signing` — a document two people sign, of any kind: its canonical form, fingerprint, signed history and proof.
- `@valnivo_labs/verify/loan` — one kind of signed document: money one person lent another.

## Licence

Apache-2.0. Copyright 2026 Valnivo Labs. Valnivo Labs is a trade name, not a registered company.
