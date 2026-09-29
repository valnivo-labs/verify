/**
 * Checking that a signed document is authentic, from the file it was saved in,
 * with nothing but the file.
 *
 * **Any document two people sign with `@valnivo_labs/signing`**, in any Valnivo
 * Labs product, whatever it says (owner, 2026-09-29: *it verifies the
 * authenticity of a document, not only loans*). A product that hands one out
 * writes its proof into the file as one comment line, `%<MARK><proof>`, which
 * no reader shows. This finds that line, checks the proof, and says what the
 * check found in one of a few words, so every place that checks a file — the
 * product's own screen, a public page, a file saved next to the document, a
 * command — says the same thing for the same file.
 *
 * **Two layers, and the first is the same for every kind.** For any document:
 * its shape, that its fingerprint is the one every step signed, and that every
 * step is signed by the key it names and linked to the one before, so nothing
 * was changed, reordered or removed. A kind may add rules of its own — a loan's
 * repayments and confirmations, its closing outcomes — and those are checked
 * only for the kinds in `KINDS`. A document of another kind still gets the first
 * layer, and is reported as `unknown-kind` with whether that layer holds.
 *
 * **And one thing the file alone cannot show**: that the history is the one the
 * product *recorded*, rather than one somebody built with keys of their own.
 * That takes the product's public record of the history (`Anchor`), which the
 * caller reads and passes in. With no way to read one, the answer is `holds`,
 * and `WITHOUT_THE_RECORD` is what it does not mean. The format is written down
 * in `PROOF.md`, so the check can be redone with any SHA-256 and ECDSA P-256
 * implementation.
 *
 * **Nothing here reaches a network.** Reading the record is the caller's.
 */
import {
  anchorProblems,
  decodeIssued,
  decodeProof,
  documentProblems,
  fingerprint,
  issuedProblems,
  issuedSignatureHolds,
  verifyHistory,
  type Anchor,
  type IssuedProof,
  type Proof,
} from './signing.ts'
import { LOAN, verifyLoanProof } from './loan.ts'

/** Where this checker and its written format are public (Apache-2.0). Only copies from here, valnivo.eu/check and `@valnivo_labs/verify` on npm are Valnivo Labs'. */
export const VERIFY_REPOSITORY = 'https://github.com/valnivo-labs/verify'

/**
 * The line each product writes its proof on, after a `%`. **Never renamed**:
 * every file already saved carries its product's mark.
 */
export const PROOF_MARKS = {
  valnivo: 'VALNIVO-PROOF-V1 ',
} as const

export type ProductMark = keyof typeof PROOF_MARKS

/** The proof a file carries, or null when it carries none. The first mark found wins. */
export function proofInFile(bytes: Uint8Array): Proof | null {
  // Latin-1 maps every byte to one character, so a binary file decodes without
  // loss and the ASCII proof line reads as itself.
  const text = new TextDecoder('latin1').decode(bytes)
  for (const mark of Object.values(PROOF_MARKS)) {
    const at = text.indexOf(`%${mark}`)
    if (at < 0) continue
    const start = at + 1 + mark.length
    const ends = [text.indexOf('\n', start), text.indexOf('\r', start)].filter((i) => i >= 0)
    const proof = decodeProof(text.slice(start, ends.length ? Math.min(...ends) : undefined))
    if (proof) return proof
  }
  return null
}

/**
 * The kinds whose own rules this checker knows, beyond what every document
 * shares. **Adding a kind is one entry here**, from that kind's package.
 */
export const KINDS = {
  [LOAN.kind]: verifyLoanProof,
} as const

export const KNOWN_KINDS: readonly string[] = Object.keys(KINDS)

/** What a registered kind's checker returns. Every kind here returns this shape today. */
export type ProofVerdict = Awaited<ReturnType<(typeof KINDS)[keyof typeof KINDS]>>

/**
 * - `authentic`: the proof holds **and** is the history the product recorded, entry for entry.
 * - `older`: it holds and is the start of the recorded history — saved before later steps.
 * - `holds`: it holds on its own, and no record was consulted (checked offline).
 * - `unanchored`: it holds on its own, and the record could not be reached.
 * - `not-authentic`: something in it is not what was signed, or no such history was recorded.
 * - `unknown-kind`: a signed document of a kind whose own rules this checker does not know.
 *   `signaturesHold` says whether everything every kind shares holds.
 * - `no-proof`: the file carries no proof.
 */
export type Outcome = 'authentic' | 'older' | 'holds' | 'unanchored' | 'not-authentic' | 'unknown-kind' | 'no-proof'

export type Checked =
  | { outcome: 'no-proof' }
  | { outcome: 'unknown-kind'; proof: Proof; kind: string; signaturesHold: boolean; termsPrint: string; problems: string[] }
  | { outcome: Exclude<Outcome, 'no-proof' | 'unknown-kind'>; proof: Proof; verdict: ProofVerdict; anchor: Anchor | null; problems: string[] }

/** Reads the product's record for a fingerprint: the anchor, null when there is none, or `unreachable`. */
export type ReadRecord = (termsPrint: string) => Promise<Anchor | null | 'unreachable'>

/**
 * What every signed document is checked for, whatever its kind: its shape, its
 * fingerprint, and every signature and link in its history. The kind's own steps
 * and rules are not — those are the kind's checker.
 */
export async function sharedProblems(proof: Proof): Promise<{ termsPrint: string; problems: string[] }> {
  const problems = documentProblems(proof.document)
  const termsPrint = problems.includes('not-document') ? '' : await fingerprint(proof.document)
  problems.push(...(await verifyHistory(proof.documentId, proof.entries ?? [], termsPrint)))
  return { termsPrint, problems }
}

/** The proof checked on its own, by its kind's checker; null for a kind with none. */
export async function checkProof(proof: Proof): Promise<ProofVerdict | null> {
  const kind = proof.document?.kind
  const checker = typeof kind === 'string' && Object.hasOwn(KINDS, kind) ? KINDS[kind as keyof typeof KINDS] : null
  return checker ? checker(proof) : null
}

/**
 * A proof checked, then compared with the record when `record` is given.
 * Without `record` the best answer is `holds`, never `authentic`.
 */
export async function checkLoaded(proof: Proof, record?: ReadRecord): Promise<Exclude<Checked, { outcome: 'no-proof' }>> {
  const verdict = await checkProof(proof)
  if (!verdict) {
    const shared = await sharedProblems(proof)
    return {
      outcome: 'unknown-kind',
      proof,
      kind: String(proof.document?.kind ?? ''),
      signaturesHold: shared.problems.length === 0,
      termsPrint: shared.termsPrint,
      problems: shared.problems,
    }
  }
  if (!verdict.authentic) return { outcome: 'not-authentic', proof, verdict, anchor: null, problems: verdict.problems }
  if (!record) return { outcome: 'holds', proof, verdict, anchor: null, problems: [] }
  const found = await record(verdict.termsPrint)
  if (found === 'unreachable') return { outcome: 'unanchored', proof, verdict, anchor: null, problems: [] }
  const problems = anchorProblems(proof, verdict.termsPrint, found)
  if (problems.length === 0) return { outcome: 'authentic', proof, verdict, anchor: found, problems }
  // The record holds every entry's hash, so "older" has been checked entry by
  // entry: this is the start of the recorded history, not a shorter one.
  if (problems.length === 1 && problems[0] === 'older-copy' && found) return { outcome: 'older', proof, verdict, anchor: found, problems }
  return { outcome: 'not-authentic', proof, verdict, anchor: found, problems }
}

/**
 * A file checked: its proof found, checked, and compared with the record when
 * `record` is given. A file carrying an **issued** proof instead is checked
 * against the pinned issuers (`checkIssued`); `options.issuers` replaces the
 * pinned list — the online checker passes the published one, so it learns of
 * a revocation an old copy of this package cannot know.
 */
export async function checkFile(bytes: Uint8Array, record?: ReadRecord, options: IssuedOptions = {}): Promise<Checked | IssuedChecked> {
  const proof = proofInFile(bytes)
  if (proof) return checkLoaded(proof, record)
  const issued = issuedInFile(bytes)
  if (!issued) return { outcome: 'no-proof' }
  const checked = await checkIssued(issued, options)
  // A document issued with its proof inside it: the rest of the file must be the file the issuer signed.
  if (checked.outcome === 'issued' && issued.document.kind === DOCUMENT_KIND) {
    if (!(await bodyMatches(bytes, issued.document.content as DocumentContent))) {
      return { ...checked, outcome: 'not-authentic', problems: ['file-changed'] }
    }
    return { ...checked, fileMatches: true }
  }
  return checked
}

/**
 * What `holds` does not mean, in the words every checker should show beside
 * it. The keys are made on each person's device, so a whole history can be
 * built with keys of one's own; only the product's record tells the two apart.
 */
export const WITHOUT_THE_RECORD =
  'Checked without the record: the document is the one its signatures cover and nothing in it has been changed, but this does not show that the history was recorded by the product rather than built with keys of somebody’s own.'

// --- `labs.timestamp`: what a checker needs of it ----------------------------

/** **Never renamed**: every timestamp already issued names it. */
export const TIMESTAMP_KIND = 'labs.timestamp'

export interface TimestampContent {
  /** Lowercase hex SHA-256 of the bytes being timestamped. */
  sha256: string
}

const HEX64 = /^[0-9a-f]{64}$/

/** Why this is not a timestamp's content, as short codes; empty means it is one. */
export function timestampProblems(content: unknown): string[] {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['not-content']
  const c = content as Record<string, unknown>
  const out: string[] = []
  for (const key of Object.keys(c)) if (key !== 'sha256') out.push(`unknown-field:${key}`)
  if (typeof c.sha256 !== 'string' || !HEX64.test(c.sha256)) out.push('sha256')
  return out
}

/** SHA-256 of a file's bytes, lowercase hex. */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(new ArrayBuffer(bytes.length))
  view.set(bytes)
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', view))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// --- `labs.document`: what a checker needs of it -----------------------------

/** **Never renamed**: every document already issued names it. */
export const DOCUMENT_KIND = 'labs.document'

/** The line's mark. The same as every issued proof's (verify's `ISSUED_MARK`). **Never renamed.** */
export const ISSUED_LINE_MARK = '%VALNIVO-ISSUED-V1 '

export const DOCUMENT_NAME_MAX = 200
export const DOCUMENT_TITLE_MAX = 200
export interface DocumentContent {
  /** Lowercase hex SHA-256 of the file without its proof line. */
  sha256: string
  /** The file's name as issued, e.g. `certificate-A1.pdf`. */
  name: string
  /** `application/pdf`, `text/plain`, … */
  mediaType: string
  /** What the issuer calls the document, e.g. "Level A1 certificate". Optional. */
  title?: string
}

const MEDIA = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim() === v && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)

/** Why this is not a `labs.document`'s content, as short codes; empty means it is one. */
export function documentContentProblems(content: unknown): string[] {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['not-content']
  const c = content as Record<string, unknown>
  const out: string[] = []
  for (const key of Object.keys(c)) if (!['sha256', 'name', 'mediaType', 'title'].includes(key)) out.push(`unknown-field:${key}`)
  if (typeof c.sha256 !== 'string' || !HEX64.test(c.sha256)) out.push('sha256')
  if (!text(c.name, DOCUMENT_NAME_MAX)) out.push('name')
  if (typeof c.mediaType !== 'string' || !MEDIA.test(c.mediaType)) out.push('media-type')
  if ('title' in c && !text(c.title, DOCUMENT_TITLE_MAX)) out.push('title')
  return out
}

const latin1 = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

/**
 * The file without its proof line, and the line — or null when the file
 * carries none. The line is `%VALNIVO-ISSUED-V1 …` up to and including its
 * `\n`, starting a line; only the **last** such line counts, so the file's own
 * content can never supply a proof for itself.
 */
export function splitIssued(bytes: Uint8Array): { body: Uint8Array; line: string } | null {
  const s = latin1(bytes)
  let at = s.lastIndexOf(ISSUED_LINE_MARK)
  while (at > 0 && s[at - 1] !== '\n' && s[at - 1] !== '\r') at = s.lastIndexOf(ISSUED_LINE_MARK, at - 1)
  if (at < 0) return null
  const nl = s.indexOf('\n', at)
  const end = nl < 0 ? s.length : nl + 1
  const line = s.slice(at, nl < 0 ? s.length : nl).replace(/\r$/, '')
  const body = new Uint8Array(bytes.length - (end - at))
  body.set(bytes.subarray(0, at), 0)
  body.set(bytes.subarray(end), at)
  return { body, line }
}

/** Whether the file, with its proof line taken out, is the one the document names. */
export async function bodyMatches(file: Uint8Array, content: DocumentContent): Promise<boolean> {
  const split = splitIssued(file)
  return !!split && (await sha256OfBytes(split.body)) === content.sha256
}

// --- Issued documents: one signer, checked against a pinned key --------------

/**
 * The line an issued proof is written on, after a `%`. One mark for every
 * issuer — the issuer is inside the document. **Never renamed.**
 */
export const ISSUED_MARK = 'VALNIVO-ISSUED-V1 '

/** One of an issuer's keys, as published. Times are ISO 8601 in UTC. */
export interface IssuerKey {
  /** `valnivo-labs`, `valnivo`, `moien` or `sway`. */
  issuer: string
  /** The name shown for the issuer, as `@valnivo_labs/identity` says it. */
  name: string
  keyId: string
  /** ECDSA P-256 public key. */
  publicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string }
  /** Documents issued before this are outside the key's life. */
  validFrom: string
  /** Set when the key is retired; documents issued at or after it are outside its life. */
  validUntil: string | null
  /** Set when the key was withdrawn; documents issued at or after it are not the issuer's. */
  revokedAt: string | null
}

/**
 * **The pinned issuers.** Each is the public half of a Cloud KMS key that
 * cannot be exported; a test brings its own and never pins one here. A new key
 * is a new entry and a new version of this package; an old one stays, with
 * `validUntil`, so what it signed can still be checked. The same list is
 * published at `https://valnivo.eu/.well-known/valnivo-labs-issuers.json`.
 *
 * - `valnivo-1`: `projects/valnivo-api/locations/europe-west1/keyRings/valnivo-labs-issuers/cryptoKeys/valnivo/cryptoKeyVersions/1`,
 *   software protection, `EC_SIGN_P256_SHA256`, created 2026-09-29.
 * - `valnivo-labs-1`: the same key ring, `cryptoKeys/valnivo-labs/cryptoKeyVersions/1`, created 2026-09-29.
 */
export const ISSUERS: readonly IssuerKey[] = [
  {
    issuer: 'valnivo',
    name: 'Valnivo',
    keyId: 'valnivo-1',
    publicKey: { kty: 'EC', crv: 'P-256', x: 'TvXV-iqeX0OZVpZIgjxQB7DfJC2wRhyFg_Sc7rbtIpE', y: 'eOGvGPwabfYkhFcXV-H6bwGImsVzfmyUe9jMGklQDfI' },
    validFrom: '2026-09-29T16:17:55Z',
    validUntil: null,
    revokedAt: null,
  },
  {
    issuer: 'valnivo-labs',
    name: 'Valnivo Labs',
    keyId: 'valnivo-labs-1',
    publicKey: { kty: 'EC', crv: 'P-256', x: '5tx67d8EPnMqHBn94ZpXYCj5SzBjb279hZpa5jj7KTY', y: 'lfjbixcKSML425wKCqoiwZBV_U-ehhyKH-IvK8XkKEw' },
    validFrom: '2026-09-29T16:54:14Z',
    validUntil: null,
    revokedAt: null,
  },
]

/** Where the published list is. An online checker reads it; an offline one has only `ISSUERS`. */
export const ISSUERS_URL = 'https://valnivo.eu/.well-known/valnivo-labs-issuers.json'

/**
 * The issued kinds whose content this checker knows. A kind returns its
 * problems with the content. **Adding a kind is one entry here.**
 */
export const ISSUED_KINDS: Record<string, (content: unknown) => string[]> = {
  [TIMESTAMP_KIND]: timestampProblems,
  [DOCUMENT_KIND]: documentContentProblems,
}

/**
 * - `issued`: the pinned key of the issuer it names signed exactly this, within the key's life —
 *   and, for a `labs.document` checked from its own file, the rest of the file is the file issued.
 * - `other-file`: a timestamp that holds, but of other bytes than the file it was checked against.
 * - `unknown-issuer`: no pinned key of that issuer has that id — never ours, or this copy is too old.
 * - `key-revoked`: dated at or after the key was withdrawn.
 * - `outside-key-validity`: dated before the key existed or after it was retired.
 * - `not-authentic`: the signature does not hold, the document is not a well-formed one of its kind,
 *   or (`file-changed`) the file around an issued document's proof is not the file that was issued.
 */
export type IssuedOutcome = 'issued' | 'other-file' | 'unknown-issuer' | 'key-revoked' | 'outside-key-validity' | 'not-authentic'

export interface IssuedChecked {
  outcome: IssuedOutcome
  issued: IssuedProof
  /** The pinned key it names, when there is one. */
  issuer: IssuerKey | null
  /** False for a kind this checker does not know: the signature holds, the content was not checked. */
  kindKnown: boolean
  /** For a `labs.document` checked from its own file: the file, with its proof line out, is the one issued. */
  fileMatches?: boolean
  problems: string[]
}

export interface IssuedOptions {
  /** Replaces `ISSUERS`: the published list, read by the caller. */
  issuers?: readonly IssuerKey[]
  /** For a timestamp: the bytes it should be of. */
  subject?: Uint8Array
}

/**
 * The issued proof a file carries, or null: the **last** line starting with
 * the mark, which is the one an issued document's check takes out of the file.
 */
export function issuedInFile(bytes: Uint8Array): IssuedProof | null {
  const split = splitIssued(bytes)
  return split ? decodeIssued(split.line.slice(1 + ISSUED_MARK.length)) : null
}

/** An issued proof as the one line a file carries, or the whole of a small file. */
export const issuedLine = (encoded: string): string => `%${ISSUED_MARK}${encoded}`

/**
 * An issued proof checked: its shape, the pinned key it names, the signature,
 * the key's life at `issuedAt`, and the kind's own content rules. With
 * `subject`, a timestamp is also compared with those bytes.
 *
 * **A revoked key is a limit, not a cure.** Whoever took the key can date a
 * document before `revokedAt`; only the issuer's own records tell those apart.
 */
export async function checkIssued(issued: IssuedProof, options: IssuedOptions = {}): Promise<IssuedChecked> {
  const doc = issued.document
  const problems = issuedProblems(doc)
  const result = (outcome: IssuedOutcome, issuer: IssuerKey | null, kindKnown: boolean): IssuedChecked => ({ outcome, issued, issuer, kindKnown, problems })
  if (problems.length) return result('not-authentic', null, false)
  const issuer = (options.issuers ?? ISSUERS).find((k) => k.issuer === doc.issuer && k.keyId === issued.keyId) ?? null
  if (!issuer) return result('unknown-issuer', null, false)
  if (!(await issuedSignatureHolds(issued, issuer.publicKey))) {
    problems.push('signature')
    return result('not-authentic', issuer, false)
  }
  const at = Date.parse(doc.issuedAt)
  if (issuer.revokedAt && at >= Date.parse(issuer.revokedAt)) return result('key-revoked', issuer, false)
  if (at < Date.parse(issuer.validFrom) || (issuer.validUntil && at >= Date.parse(issuer.validUntil))) return result('outside-key-validity', issuer, false)
  const rules = Object.hasOwn(ISSUED_KINDS, doc.kind) ? ISSUED_KINDS[doc.kind] : null
  if (rules) {
    problems.push(...rules(doc.content))
    if (problems.length) return result('not-authentic', issuer, true)
  }
  if (doc.kind === TIMESTAMP_KIND && options.subject) {
    const sha = await sha256OfBytes(options.subject)
    if (sha !== (doc.content as { sha256: string }).sha256) return result('other-file', issuer, true)
  }
  return result('issued', issuer, Boolean(rules))
}

/**
 * What `issued` does not mean, in the words every checker should show beside
 * it. The issuer's time is its own claim, and a timestamp is about bytes, not
 * about what they say or who holds them.
 */
export const ISSUED_LIMIT =
  'Issued: the issuer’s pinned key signed exactly this at the time it states. The time is the issuer’s own claim, and the issuer vouches for nothing but what the document says it vouches for — a timestamp, for instance, shows only that the file’s fingerprint existed then, not what the file says or who holds it.'
