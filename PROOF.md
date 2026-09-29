# The proof format: `valnivo-labs-proof-v1`

This is how **any document two people sign in a Valnivo Labs product** carries the evidence that lets
anybody check it is authentic, and how to check it **by hand, without our code and without our
servers**. A document has a *kind*, which says what it is: the checks in §1–§4 and §6 are the same for
every kind, and a kind may add rules of its own (§5). The first kind in use is Valnivo's `labs.loan`,
money lent between two people. Everything below is plain SHA-256, ECDSA P-256 and JSON; any language
with those three can redo it. `@valnivo_labs/verify` is one implementation of it, and
`tests/verify.test.ts` holds this document's constants to the code.

**What a check can show.** That the text is the one both people signed, that every step in its
history is signed by the key it names, and that nothing was changed, reordered or removed. **What it
cannot show without the product's record** is that the history is the one the product recorded: the
keys are made on each person's device, so somebody can build a whole history with keys of their own.
§6 is the record; a check that did not consult it should say so.

A proof is evidence of what two accounts signed. **It is not a qualified electronic signature**, and
it does not by itself make any agreement legally binding.

## 1. Where it is in the file

One line of the file, beginning with `%` and the product's mark, followed by the proof encoded as
below and the end of the line:

| Product | Line |
|---|---|
| Valnivo | `%VALNIVO-PROOF-V1 <proof>` |

In a PDF a line beginning `%` is a comment, so no reader shows it. Read the file as bytes (Latin-1 is
lossless), find the mark, and take everything up to the next `\n` or `\r`.

**The encoding.** `<proof>` is **base64url without padding** of the UTF-8 bytes of the proof's
**canonical JSON** (§2). Decoded, it is an object:

```
{ "format": "valnivo-labs-proof-v1",
  "documentId": "<the document's id>",
  "document":   <the signed document, §3>,
  "entries":    [ <history entries, §4> ],
  "payloads":   { "<entry hash>": <opened payload, §5>, … } }
```

## 2. Canonical JSON

JSON with the keys of every object **sorted** (by UTF-16 code unit, JavaScript's default sort), at
every depth, no whitespace, strings and numbers written as `JSON.stringify` writes them. Everything
hashed or signed below is canonical JSON.

## 3. The document and its fingerprint

```
{ "version": 1, "kind": "<the kind, e.g. labs.loan>", "proposerName": "…", "counterpartyName": "…",
  "content": { … }, "nonce": "<43 characters: 32 random bytes, base64url>" }
```

**The fingerprint** (`termsPrint`) is the lowercase hex SHA-256 of the UTF-8 bytes of

```
Valnivo Labs signed document v1\n<canonical JSON of the six fields above>
```

The nonce makes the fingerprint unguessable, so it can be published without revealing the text.

## 4. The history

Each entry:

```
{ "seq": 0, "act": "proposed", "role": "proposer", "byUid": "<account>",
  "termsPrint": "<fingerprint>", "prevHash": "", "detail": "…",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "…", "y": "…" },
  "signature": "<base64url>", "hash": "<hex>", "at": <milliseconds> }
```

Check, for the entries in `seq` order:

1. `seq` runs 0, 1, 2, … with no gap, and entry 0 is `act: "proposed"`, `role: "proposer"`.
2. Every `termsPrint` is the fingerprint of §3.
3. `prevHash` is the previous entry's `hash`, and empty for entry 0.
4. **The statement** is the UTF-8 bytes of
   `Valnivo Labs signed history v1\n` followed by the canonical JSON of
   `{documentId, seq, act, role, byUid, termsPrint, prevHash, detail}` — `documentId` from the proof.
5. **The signature** verifies over the statement with ECDSA P-256 and SHA-256, the public key being
   the entry's `publicKey`. It is the raw 64-byte `r‖s` form (IEEE P1363, what WebCrypto produces),
   base64url without padding — not DER.
6. **The hash** is the lowercase hex SHA-256 of the UTF-8 bytes of
   `<statement>\n<canonical JSON of {kty, crv, x, y}>\n<signature>`.
7. `at` is the product's server time. It is **not** signed or hashed: it is what the product's
   database stamped, and the record (§6) is what fixes it.

**The steps.** Replaying the acts `signed`, `declined`, `withdrawn` and `closed` must follow the
document's kind: from *proposed* the counterparty may sign or decline and the proposer may withdraw;
from *signed* only the roles the kind names may close, with the outcomes it names. `opened` moves
nothing. A checker that does not know a kind can still check everything in §1–§4 for it; only the
kind's own steps and rules (§5) need that kind's definition.

## 5. A kind's own rules

A kind names who may close a signed document and with which outcomes, and may add acts and checks of
its own. The kinds defined today:

### `labs.loan` — money one person lent another (Valnivo)

The proposer is the lender and the counterparty the borrower; only the lender closes, with `detail`
one of `settled`, `forgiven` or `replaced`.

- **`repayment`**: `detail` is the hex SHA-256 of the canonical JSON of the opened payload
  `{amountMinor, paidOn, nonce}`, which the proof carries in `payloads` under the entry's `hash`. The
  amount is signed without being written in the entry.
- **`confirmation`**: `detail` is the `hash` of the repayment entry it confirms, and its `role` is the
  other person's. A repayment counts once it is confirmed.
- Both come after `signed` and before `closed`. The loan's `content` is a closed set of fields —
  `amountMinor`, `currency`, `lentOn`, `schedule`, `note`, and optionally `replaces` — and anything
  else, a rate or a fee among them, makes the proof not authentic.

## 6. The record

The product keeps, readable by anyone who has the fingerprint:

```
{ "documentId": "…", "termsPrint": "…", "historyCount": n, "lastHash": "…", "hashes": [ … ] }
```

It grows by exactly one hash per step, written in the same request as the step, and is never
rewritten. A proof is **the recorded history** when its entries' hashes are the record's, in order; it
is an **older copy** when they are the start of the record's list; anything else is not the recorded
history. For Valnivo the record of fingerprint `P` is the Firestore document `loanSeals/P` of project
`ledgger-3950a`.

**If the product is gone**, so is the record, and the best a check can say is §4 and §5: this is the
text two keys signed, unchanged. Which accounts those keys belonged to is then only what the entries
say (`byUid`, and for Valnivo the verified address in the `detail` of the proposal and the opening).

## 7. Issued documents: `valnivo-labs-issued-v1`

An **issued** document has one signer: the issuer — Valnivo Labs or one of its products, never a
person — with a key that is the issuer's alone. It is checked against the issuer's **published public
key**, not against a record. A file carries either a two-party proof (§1–§6) or an issued one.

**Where it is.** One line, `%VALNIVO-ISSUED-V1 <proof>` — the same mark for every issuer, since the
issuer is named inside. For a timestamp the line is usually the whole of a small file kept beside the
file it is about, because a file cannot carry its own fingerprint. `<proof>` is base64url without
padding of the UTF-8 bytes of the canonical JSON (§2) of

```
{ "format": "valnivo-labs-issued-v1",
  "document": { "version": 1, "kind": "<e.g. labs.timestamp>", "issuer": "<issuer id>",
                "issuedAt": "<ISO 8601, UTC>", "content": { … }, "nonce": "<43 characters>" },
  "keyId": "<which of the issuer's keys>",
  "signature": "<base64url>" }
```

**The check.**

1. **The signed bytes** are the UTF-8 bytes of `Valnivo Labs issued document v1\n` followed by the
   canonical JSON of the six fields of `document`. The different first line means an issued signature
   can never pass for a history entry's (§4), nor one for the other.
2. **Find the key**: in the issuers list, the entry whose `issuer` is `document.issuer` and whose
   `keyId` is the proof's. None means the document is not the issuer's — or the list you hold is older
   than the key.
3. **The signature** verifies over the signed bytes with ECDSA P-256 and SHA-256, raw 64-byte `r‖s`
   (IEEE P1363), base64url — as in §4.
4. **The key's life**: `validFrom ≤ issuedAt`, and `issuedAt < validUntil` when that is set. When the
   key has a `revokedAt`, a document with `issuedAt ≥ revokedAt` is not the issuer's.
5. **The kind's own rules** (below).

**The issuers list** is published at `https://valnivo.eu/.well-known/valnivo-labs-issuers.json`: an
array of `{issuer, name, keyId, publicKey: {kty, crv, x, y}, validFrom, validUntil, revokedAt}`. A
checker may pin a copy and work offline, but **a pinned copy does not learn of a revocation**; an
online check should read the published list.

**What it shows, and what it does not.** That the issuer's key signed exactly this document. The
`issuedAt` is **the issuer's own claim**: the signature fixes it, and only the issuer's honesty makes
it true, as with a stamp on paper. A revocation is a limit rather than a cure — whoever held a stolen
key could date a document before `revokedAt`. The issuer vouches for nothing but what the kind says it
vouches for. This is **not a qualified electronic seal** under eIDAS, which needs a certificate from a
qualified trust service provider.

### `labs.timestamp` — this fingerprint existed at this time

`content` is exactly `{ "sha256": "<64 lowercase hex characters>" }`, the SHA-256 of the bytes that
were timestamped; any other field makes it not authentic. The issuer is sent the fingerprint and never
the file. To check a timestamp *of a file*, also compute that file's SHA-256 and compare: equal means
these bytes existed at `issuedAt`; different means the timestamp is of other bytes. It says nothing
about what the file says or who holds it.

### `labs.document` — a file issued by Valnivo Labs or a product, its proof inside it

The issuer — `valnivo-labs`, or a product — vouches that **it issued this file**. `content` is exactly
`{ "sha256", "name", "mediaType" }` and optionally `"title"`: the SHA-256 of the file as issued, the
file's name, its media type and what the issuer calls it. Any other field makes it not authentic.

**The proof is inside the file**, on the **last line beginning `%VALNIVO-ISSUED-V1 `** — in a PDF, just
before the final `%%EOF`, where a line beginning `%` is a comment and no offset moves; in any other file,
as its last line. To check it:

1. Find that last line, and check the proof on it as above (steps 1–5).
2. **Take the line out** — from its `%` to and including its `\n` — and hash what is left with SHA-256.
3. It must equal `content.sha256`. If it does not, the file around the proof is not the file that was
   issued: something in it was changed.

It shows that the issuer's key issued exactly this file at `issuedAt`. What the file says is the
issuer's statement, and only as trustworthy as the issuer.
