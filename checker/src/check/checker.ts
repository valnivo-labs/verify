/**
 * The checker for a signed loan PDF, as a page: choose a file, read it here,
 * say what it is. **One UI, mounted two ways** (`docs/agreements.md` §5):
 *
 * - `/check/` on valnivo.eu passes `record`, so a file that holds is also
 *   compared with Valnivo's public record of its history — what the app's own
 *   *Check a document* does;
 * - `valnivo-checker.html`, the file a person saves beside their PDF, passes
 *   nothing, makes **no request of any kind**, and so still works when
 *   valnivo.eu does not. Its best answer is *holds*, and it says what that
 *   does not mean.
 *
 * The check is the foundation's (`@valnivo_labs/verify`), so all three say the
 * same word for the same file. **English only**, like the PDF it checks: a
 * document people file is read by whoever they hand it to.
 *
 * **Everything a proof says was written by the people who signed it**, so it is
 * put on the page as text and never as markup — `tests/checker.test.ts` fails
 * on `innerHTML` here.
 */
import { IDENTITY_PAYLOAD } from '../lib/identity.generated'
import type { HistoryEntry } from '../lib/signing.generated'
import type { LoanContent } from '../lib/loan.generated'
import { VERIFY_REPOSITORY, WITHOUT_THE_RECORD, checkFile, type Checked, type ReadRecord } from '../lib/verify.generated'

type Child = Node | string | null | false | undefined

function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  for (const c of children) if (c) el.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return el
}

/** Money in its currency's own minor unit, or the raw figure for a currency Intl does not know. */
export function money(minor: number, currency: string): string {
  try {
    const f = new Intl.NumberFormat('en-GB', { style: 'currency', currency })
    const digits = f.resolvedOptions().maximumFractionDigits ?? 2
    return f.format(minor / 10 ** digits)
  } catch {
    return `${minor} (smallest unit) ${currency}`
  }
}

const when = (at: number | undefined) => (typeof at === 'number' && Number.isFinite(at) ? `${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'no time recorded')

const ACTS: Record<string, string> = {
  proposed: 'Proposed and signed by the lender',
  opened: 'Opened by the borrower',
  signed: 'Signed by the borrower',
  declined: 'Declined by the borrower',
  withdrawn: 'Withdrawn by the lender',
  closed: 'Closed by the lender',
  repayment: 'A repayment recorded',
  confirmation: 'A repayment confirmed by the other person',
}

const CLOSED: Record<string, string> = {
  settled: 'Closed: paid back',
  forgiven: 'Closed: the rest let go',
  replaced: 'Closed: replaced by a correction both signed',
}

/** The sentence for an outcome. `online` says whether this checker could have asked for the record. */
export function sentenceFor(result: Checked, online: boolean): string {
  switch (result.outcome) {
    case 'authentic':
      return 'Authentic. The terms are the ones both people signed, every step is signed and unbroken, and it is the history Valnivo recorded.'
    case 'older':
      return 'Authentic, and older than the record: every step in it is the recorded one, and more have been recorded since.'
    case 'holds':
      return 'The document holds together: its terms are the ones both people signed, and every step in it is signed and unbroken.'
    case 'unanchored':
      return online
        ? 'The document holds together, but Valnivo’s record could not be reached to confirm it is the recorded history. Try again when you are online.'
        : 'The document holds together.'
    case 'not-authentic':
      return 'Not authentic. Something in it is not what was signed, or Valnivo never recorded it.'
    case 'unknown-kind':
      return 'This file carries a signed document, but not a loan: this checker reads only loans.'
    case 'no-proof':
      return 'Not authentic: this file carries no Valnivo proof. It was not saved from Valnivo, or its proof was removed.'
  }
}

/** What the proof itself says, for comparing with the printed page. */
function whatItSays(result: Extract<Checked, { verdict: unknown }>): HTMLElement {
  const doc = result.proof.document
  const content = doc.content as LoanContent
  const entries = [...result.proof.entries].sort((a, b) => a.seq - b.seq) as HistoryEntry[]
  const address = (act: string) => {
    const d = entries.find((e) => e.act === act)?.detail ?? ''
    return /^[^\s@]+@[^\s@]+$/.test(d) ? d : null
  }
  const lender = address('proposed')
  const borrower = address('opened')
  const status = result.verdict.closedAs ? CLOSED[result.verdict.closedAs] : result.verdict.status === 'signed' ? 'Signed by both' : `Status: ${result.verdict.status ?? 'unreadable'}`
  return h(
    'section',
    { class: 'ck-says' },
    h('h2', {}, 'What the proof itself says'),
    h('p', { class: 'ck-hint' }, 'Compare it with the printed page. If they differ, the page was changed; the proof is what was signed.'),
    h('p', {}, `${doc.proposerName} lent ${doc.counterpartyName} ${money(content.amountMinor, content.currency)} on ${content.lentOn}.`),
    content.note ? h('p', {}, `Note: ${content.note}`) : null,
    h('h3', {}, 'To be paid back'),
    h('ul', {}, ...content.schedule.map((r) => h('li', {}, `${money(r.amountMinor, content.currency)} by ${r.dueOn}`))),
    content.replaces
      ? h('p', {}, `A correction of loan ${content.replaces.documentId}, carrying ${money(content.replaces.paidMinor, content.currency)} already paid back under it.`)
      : null,
    result.verdict.repayments.length
      ? h(
          'div',
          {},
          h('h3', {}, 'Repayments'),
          h(
            'ul',
            {},
            ...result.verdict.repayments.map((r) =>
              h('li', {}, `${money(r.amountMinor, content.currency)} on ${r.paidOn}, recorded by the ${r.recordedBy === 'proposer' ? 'lender' : 'borrower'}, ${r.confirmed ? 'confirmed by the other person' : 'not confirmed'}`),
            ),
          ),
        )
      : null,
    h('p', { class: 'ck-strong' }, status),
    h('h3', {}, 'Who signed'),
    lender || borrower
      ? h(
          'ul',
          {},
          lender ? h('li', {}, `Lender: ${doc.proposerName}, signed in as ${lender}`) : null,
          borrower ? h('li', {}, `Borrower: ${doc.counterpartyName}, signed in as ${borrower}`) : null,
        )
      : h('p', {}, 'No address was recorded: this loan was signed before 29 September 2026.'),
    h('p', { class: 'ck-hint' }, 'The addresses were verified by Google when they signed. A name is what was written; the address is what shows which account signed.'),
    h('h3', {}, 'Every step'),
    h('ol', { class: 'ck-steps' }, ...entries.map((e) => h('li', {}, `${ACTS[e.act] ?? e.act} — ${when(e.at)}`))),
    h('p', { class: 'ck-hint' }, `Fingerprint of the terms: ${result.verdict.termsPrint}`),
  )
}

export interface MountOptions {
  /** Reads Valnivo's record of a history. Absent in the offline file, which asks nobody anything. */
  record?: ReadRecord
  /** Where the saved-to-disk copy of this checker is offered from; absent in that copy itself. */
  offlineHref?: string
  /**
   * SHA-256 of that file, as this site serves it. With it, a checker file chosen here is compared
   * with the official one — the answer to somebody handing you a doctored copy.
   */
  offlineSha256?: string
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function mountChecker(root: HTMLElement, options: MountOptions = {}): void {
  const online = !!options.record
  const result = h('div', { class: 'ck-result', role: 'status', 'aria-live': 'polite' })
  const input = h('input', { type: 'file', accept: options.offlineSha256 ? 'application/pdf,.pdf,.html,text/html' : 'application/pdf,.pdf', id: 'ck-file', class: 'ck-input' }) as HTMLInputElement

  const check = async (file: File | undefined) => {
    if (!file) return
    result.replaceChildren(h('p', {}, 'Checking…'))
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (options.offlineSha256 && /.html?$/i.test(file.name)) {
      const sha = hex(await crypto.subtle.digest('SHA-256', bytes))
      const same = sha === options.offlineSha256
      result.replaceChildren(
        h('p', { class: same ? 'ck-verdict ck-good' : 'ck-verdict ck-bad' }, same
          ? 'This is the official checker: byte for byte the file this site serves.'
          : 'This is not the checker this site serves. Do not rely on what it says; use this page, or save the official copy below.'),
        h('p', { class: 'ck-hint' }, `SHA-256 of the file you chose: ${sha}`),
      )
      return
    }
    const found = await checkFile(bytes, options.record)
    const bad = found.outcome === 'not-authentic' || found.outcome === 'no-proof' || found.outcome === 'unknown-kind'
    const parts: Child[] = [
      h('p', { class: bad ? 'ck-verdict ck-bad' : 'ck-verdict ck-good' }, sentenceFor(found, online)),
      found.outcome === 'holds' ? h('p', { class: 'ck-limit' }, WITHOUT_THE_RECORD) : null,
      'verdict' in found ? whatItSays(found) : null,
      'problems' in found && found.problems.length
        ? h('details', {}, h('summary', {}, 'What did not hold'), h('p', { class: 'ck-hint' }, found.problems.join(', ')))
        : null,
    ]
    result.replaceChildren(...parts.filter((c): c is Node => !!c))
  }
  input.addEventListener('change', () => void check(input.files?.[0]))
  const drop = h('label', { for: 'ck-file', class: 'ck-drop' }, h('strong', {}, online ? 'Choose a signed loan PDF — or a checker file, to see if it is the official one' : 'Choose a signed loan PDF'), h('span', {}, 'or drop it here'), input)
  drop.addEventListener('dragover', (e) => {
    e.preventDefault()
    drop.classList.add('ck-over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('ck-over'))
  drop.addEventListener('drop', (e) => {
    e.preventDefault()
    drop.classList.remove('ck-over')
    void check((e as DragEvent).dataTransfer?.files?.[0])
  })

  root.replaceChildren(
    h(
      'main',
      { class: 'ck' },
      h('p', { class: 'ck-eyebrow' }, 'Valnivo · money lent, signed by both'),
      h('h1', {}, 'Check a signed loan'),
      h(
        'p',
        {},
        online
          ? 'Choose a loan PDF saved from Valnivo. It is read in this browser; the only thing sent is its fingerprint, to compare it with Valnivo’s record.'
          : 'Choose a loan PDF saved from Valnivo. This file checks it on this computer and sends nothing anywhere, so it works with no connection and without Valnivo.',
      ),
      drop,
      result,
      h(
        'section',
        { class: 'ck-about' },
        h('h2', {}, 'What a check shows'),
        h('p', {}, 'That the terms are the ones both people signed, that every step is signed on the device of the person who took it, and that nothing was changed, reordered or removed since.'),
        online
          ? h('p', {}, 'Compared with Valnivo’s record, it also shows that this is the history Valnivo recorded, and not one somebody built with keys of their own.')
          : h('p', {}, WITHOUT_THE_RECORD),
        h('p', {}, 'It is a record two accounts signed. It is not a loan agreement and not legally binding, and Valnivo is not a party to it.'),
        h(
          'p',
          {},
          'The format is public, so the same check can be made without Valnivo: ',
          h('a', { href: VERIFY_REPOSITORY, rel: 'noreferrer' }, VERIFY_REPOSITORY.replace('https://', '')),
          ' (Apache-2.0), or npx @valnivo_labs/verify loan.pdf.',
        ),
        options.offlineHref
          ? h(
              'p',
              {},
              h('a', { href: options.offlineHref, download: 'valnivo-checker.html' }, 'Save this checker'),
              ' — one file that checks a loan PDF with no connection, and keeps working if this site is ever gone. Keep it beside your PDF.',
            )
          : null,
        options.offlineSha256
          ? h(
              'p',
              { class: 'ck-hint' },
              `The official checker's SHA-256 is ${options.offlineSha256}. Every release on GitHub lists the same value and is attested as built by that repository. To check a copy somebody gave you, choose it above instead of a PDF.`,
            )
          : null,
      ),
      h('footer', { class: 'ck-foot' }, IDENTITY_PAYLOAD.sentences.en.providedBy),
    ),
  )
}
