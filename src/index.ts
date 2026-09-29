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
  decodeProof,
  documentProblems,
  fingerprint,
  verifyHistory,
  type Anchor,
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

/** A file checked: its proof found, checked, and compared with the record when `record` is given. */
export async function checkFile(bytes: Uint8Array, record?: ReadRecord): Promise<Checked> {
  const proof = proofInFile(bytes)
  if (!proof) return { outcome: 'no-proof' }
  return checkLoaded(proof, record)
}

/**
 * What `holds` does not mean, in the words every checker should show beside
 * it. The keys are made on each person's device, so a whole history can be
 * built with keys of one's own; only the product's record tells the two apart.
 */
export const WITHOUT_THE_RECORD =
  'Checked without the record: the document is the one its signatures cover and nothing in it has been changed, but this does not show that the history was recorded by the product rather than built with keys of somebody’s own.'
