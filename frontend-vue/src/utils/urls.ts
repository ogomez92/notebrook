/**
 * URL extraction for Shift+Enter link opening.
 */

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

// Punctuation that almost always belongs to the sentence, not the link
const TRAILING_PUNCTUATION = /[.,;:!?'"”’»]+$/

/**
 * Trim sentence punctuation that the greedy match swallowed.
 *
 * "see https://example.com/a, and ..." must yield ".../a", not ".../a,".
 * Closing parens are only dropped when unbalanced, so
 * https://en.wikipedia.org/wiki/Foo_(bar) survives intact.
 */
function trimTrailingPunctuation(url: string): string {
  let result = url

  for (;;) {
    const trimmed = result.replace(TRAILING_PUNCTUATION, '')
    if (trimmed !== result) {
      result = trimmed
      continue
    }

    if (result.endsWith(')')) {
      const opens = (result.match(/\(/g) || []).length
      const closes = (result.match(/\)/g) || []).length
      if (closes > opens) {
        result = result.slice(0, -1)
        continue
      }
    }

    return result
  }
}

/**
 * Extract URLs from message text, de-duplicated and in order of appearance.
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX) || []
  const cleaned = matches
    .map(trimTrailingPunctuation)
    // A bare scheme is left over when the "URL" was only punctuation
    .filter((url) => /^https?:\/\/[^/]/i.test(url))
  return [...new Set(cleaned)]
}
