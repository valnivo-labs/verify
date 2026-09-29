/**
 * The checker as one file a person keeps: `valnivo-checker.html`, built by
 * `tools/build-checker.mjs`. It is given no record reader, so it asks nobody
 * anything — its own Content-Security-Policy forbids every connection — and it
 * keeps working when valnivo.eu does not. Its best answer is *holds*.
 *
 * **Imports nothing that reaches a network**: `tests/checker.test.ts` walks
 * this file's imports and the build refuses a bundle that could.
 */
import { mountChecker } from './checker'

mountChecker(document.getElementById('root')!)
