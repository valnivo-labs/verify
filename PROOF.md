# The proof format: `valnivo-labs-proof-v1`

This is how a signed document from a Valnivo Labs product — today, Valnivo's *money lent between two
people* — carries the evidence that lets anybody check it, and how to check it **by hand, without our
code and without our servers**. Everything below is plain SHA-256, ECDSA P-256 and JSON; any language
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
{ "version": 1, "kind": "labs.loan", "proposerName": "…", "counterpartyName": "…",
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
from *signed* only the roles the kind names may close. `opened` moves nothing. For `labs.loan` only
the proposer (the lender) closes, with `detail` one of `settled`, `forgiven`, `replaced`.

## 5. A loan's own acts

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
