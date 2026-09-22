// Reimplementation of the editor's short_uid() (edit.js) and its batch allocation scheme.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = 52n;
const THREE_DIGIT_MAX = 70304n;
const FIVE_DIGIT_MAX = 175478784n;
const FIVE_DIGIT_OFFSET = 190102016n;
const TEN_DIGIT_OFFSET = 0x1edcf7bcf280000n;
const MAX_SHORT_UID = 100000000000000n;

export function shortUid(counter: number, editorId: number | string): string {
  let c = BigInt(counter), digits: number;
  if (c < THREE_DIGIT_MAX) digits = 3;
  else if (c < FIVE_DIGIT_MAX) { digits = 5; c += FIVE_DIGIT_OFFSET; }
  else if (c < MAX_SHORT_UID) { digits = 10; c += TEN_DIGIT_OFFSET; }
  else throw new Error('counter out of short uid range');
  const out: string[] = new Array(digits);
  for (let i = digits - 1; i >= 0; i--) { out[i] = ALPHABET[Number(c % BASE)]; c /= BASE; }
  return out.join('') + (String(editorId) === '-1' ? '' : String(editorId));
}

// Editor reserves batches of 6 and uses the top 3 of each (UID_BATCH_SIZE / SKIPPED_PORTION_OF_BATCH_SIZE).
const BATCH = 6, SKIP = 3;

/** Given the server's current counter, return `n` counters and the new counter value to persist. */
export function allocate(current: number, n: number): { counters: number[]; next: number } {
  const counters: number[] = [];
  let count = current;
  while (counters.length < n) {
    for (let i = 0; i < BATCH - SKIP && counters.length < n; i++) counters.push(count + i + 1 + SKIP);
    count += BATCH;
  }
  return { counters, next: count };
}
