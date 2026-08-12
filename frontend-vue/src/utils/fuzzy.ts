/**
 * Fuzzy matching for message search.
 *
 * "Fuzzy" here means *close matches*: each whitespace-separated term in the
 * query has to match a **word** in the message — exactly, as a prefix, as a
 * substring of that word, or within a small edit distance, so "releaes" and
 * "releas" both find "release".
 *
 * It is deliberately not a subsequence match over the whole message. Letting a
 * query's letters scatter across the text ("r…e…l…e…a…s…e") is technically a
 * match and practically noise: on real chat data almost every message contains
 * the letters of almost every word, so a search for "release" returned 155 of
 * 165 messages. Precision matters far more than reach here.
 */

export interface FuzzyMatch {
  /** Higher is better. Only comparable between matches of the same query. */
  score: number
  /** Matched character positions in the original text, ascending. */
  indices: number[]
}

export interface FuzzyResult<T> {
  item: T
  score: number
  indices: number[]
}

/** Chat messages are short; this just stops one pasted wall of text from stalling a keystroke. */
const MAX_TEXT_LENGTH = 2000
const MAX_WORDS = 400

const SCORE_EXACT_WORD = 100
const SCORE_PREFIX = 86
const SCORE_SUBSTRING = 66
const SCORE_LITERAL = 76
const SCORE_TYPO_BASE = 58
const PENALTY_PER_EDIT = 20
/** A prefix match on a much longer word is a weaker signal ("cat" in "catastrophe"). */
const PENALTY_PER_EXTRA_CHAR = 1.5
const PENALTY_EXTRA_MAX = 18
const BONUS_EARLY_WORD = 10
const BONUS_IN_ORDER = 12
const BONUS_ADJACENT = 18

/** Below this, a term must match the start of a word — "e" shouldn't hit "release". */
const MIN_SUBSTRING_TERM = 3

const WORD_PATTERN = /[\p{L}\p{N}]+/gu
const IS_WORD = /^[\p{L}\p{N}]+$/u

/**
 * How many typos to forgive, by term length. Short terms get none — at three
 * letters, one edit reaches too much of the dictionary to be useful.
 */
function maxEdits(length: number): number {
  if (length <= 3) return 0
  if (length <= 7) return 1
  return 2
}

interface Word {
  /** Offset in the original text. */
  start: number
  /** Lowercased word text. */
  text: string
}

function extractWords(lowerText: string): Word[] {
  const words: Word[] = []
  WORD_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = WORD_PATTERN.exec(lowerText)) !== null && words.length < MAX_WORDS) {
    words.push({ start: match.index, text: match[0] })
  }

  return words
}

/**
 * Smallest edit distance between `term` and any *prefix* of `word`, or Infinity
 * if nothing gets under `maxDistance`.
 *
 * Prefixes rather than the whole word, so "releas" still reaches "releasing".
 * Distance is optimal string alignment — a transposition costs 1 rather than 2,
 * because two swapped letters are the most common typo there is.
 */
function prefixEditDistance(term: string, word: string, maxDistance: number): number {
  const termLength = term.length
  // A prefix longer than this can't possibly be within maxDistance.
  const width = Math.min(word.length, termLength + maxDistance)
  if (width < termLength - maxDistance) return Infinity

  // Rolling rows; OSA needs the two previous ones to price a transposition.
  let beforePrevious: number[] = new Array(width + 1).fill(0)
  let previous: number[] = new Array(width + 1)
  let current: number[] = new Array(width + 1)

  for (let j = 0; j <= width; j++) previous[j] = j

  for (let i = 1; i <= termLength; i++) {
    current[0] = i
    let rowBest = i

    for (let j = 1; j <= width; j++) {
      const substitution = (previous[j - 1] ?? 0) + (term[i - 1] === word[j - 1] ? 0 : 1)
      let best = Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution)

      if (
        i > 1 &&
        j > 1 &&
        term[i - 1] === word[j - 2] &&
        term[i - 2] === word[j - 1]
      ) {
        best = Math.min(best, (beforePrevious[j - 2] ?? 0) + 1)
      }

      current[j] = best
      if (best < rowBest) rowBest = best
    }

    // Every alignment through this row is already too expensive.
    if (rowBest > maxDistance) return Infinity

    const recycled = beforePrevious
    beforePrevious = previous
    previous = current
    current = recycled
  }

  // The answer is the cheapest prefix, i.e. the best entry in the final row.
  let best = Infinity
  for (let j = Math.max(0, termLength - maxDistance); j <= width; j++) {
    const value = previous[j]
    if (value !== undefined && value < best) best = value
  }

  return best
}

interface TermMatch {
  score: number
  /** Range to highlight, in original-text coordinates. */
  start: number
  length: number
  /** Index of the word matched, or -1 for a literal match spanning punctuation. */
  wordIndex: number
}

function matchTermInWords(term: string, words: Word[]): TermMatch | null {
  const editBudget = maxEdits(term.length)
  let best: TermMatch | null = null

  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (!word) continue

    let score = -Infinity
    let start = word.start
    let length = word.text.length

    if (word.text === term) {
      score = SCORE_EXACT_WORD
    } else if (word.text.startsWith(term)) {
      score =
        SCORE_PREFIX -
        Math.min((word.text.length - term.length) * PENALTY_PER_EXTRA_CHAR, PENALTY_EXTRA_MAX)
      length = term.length
    } else if (term.length >= MIN_SUBSTRING_TERM) {
      const at = word.text.indexOf(term)
      if (at !== -1) {
        score = SCORE_SUBSTRING
        start = word.start + at
        length = term.length
      }
    }

    if (score === -Infinity && editBudget > 0) {
      const distance = prefixEditDistance(term, word.text, editBudget)
      if (distance <= editBudget) score = SCORE_TYPO_BASE - distance * PENALTY_PER_EDIT
    }

    if (score === -Infinity) continue

    // Words near the start of a message are likelier to be what was meant.
    score += Math.max(0, BONUS_EARLY_WORD - i * 2)

    if (!best || score > best.score) best = { score, start, length, wordIndex: i }
  }

  return best
}

/**
 * Terms carrying punctuation ("example.com", "2026-08-12") never line up with a
 * single word, so they're matched against the raw text instead.
 */
function matchLiteral(term: string, lowerText: string): TermMatch | null {
  const at = lowerText.indexOf(term)
  if (at === -1) return null
  return { score: SCORE_LITERAL, start: at, length: term.length, wordIndex: -1 }
}

/** Reward terms that matched consecutive words, i.e. the query as a phrase. */
function phraseBonus(wordIndices: number[]): number {
  if (wordIndices.length < 2 || wordIndices.some((index) => index < 0)) return 0

  let adjacent = true
  for (let i = 1; i < wordIndices.length; i++) {
    const previous = wordIndices[i - 1] ?? 0
    const current = wordIndices[i] ?? 0
    if (current <= previous) return 0
    if (current !== previous + 1) adjacent = false
  }

  return adjacent ? BONUS_ADJACENT : BONUS_IN_ORDER
}

/**
 * Match `query` against `text`, or null if any term fails to find a word.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null

  const scanned = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
  const lowerText = scanned.toLowerCase()
  const words = extractWords(lowerText)

  let score = 0
  const indices = new Set<number>()
  const matchedWords: number[] = []

  for (const term of terms) {
    const match = IS_WORD.test(term)
      ? matchTermInWords(term, words)
      : matchLiteral(term, lowerText)

    if (!match) return null

    score += match.score
    for (let i = 0; i < match.length; i++) indices.add(match.start + i)
    matchedWords.push(match.wordIndex)
  }

  score += phraseBonus(matchedWords)

  return {
    score,
    indices: [...indices].sort((a, b) => a - b)
  }
}

/**
 * Fuzzy-filter a list, best match first. Ties keep the input order, so callers
 * can pre-sort by recency and have that survive as the tiebreak.
 */
export function fuzzyFilter<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string
): FuzzyResult<T>[] {
  if (!query.trim()) return []

  const results: FuzzyResult<T>[] = []
  for (const item of items) {
    const match = fuzzyMatch(query, getText(item) || '')
    if (match) results.push({ item, score: match.score, indices: match.indices })
  }

  // Array#sort is stable, so equal scores keep the caller's input order.
  return results.sort((a, b) => b.score - a.score)
}

export interface HighlightSegment {
  text: string
  match: boolean
}

/**
 * Split `text` into alternating plain/matched runs for rendering. Always
 * returns at least one segment so callers can render it unconditionally.
 */
export function highlightSegments(text: string, indices?: number[]): HighlightSegment[] {
  if (!indices || indices.length === 0) return [{ text, match: false }]

  const matched = new Set(indices)
  const segments: HighlightSegment[] = []
  let buffer = ''
  let bufferIsMatch = matched.has(0)

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === undefined) continue

    const isMatch = matched.has(i)
    if (isMatch !== bufferIsMatch) {
      if (buffer) segments.push({ text: buffer, match: bufferIsMatch })
      buffer = ''
      bufferIsMatch = isMatch
    }
    buffer += char
  }

  if (buffer) segments.push({ text: buffer, match: bufferIsMatch })

  return segments.length > 0 ? segments : [{ text, match: false }]
}
