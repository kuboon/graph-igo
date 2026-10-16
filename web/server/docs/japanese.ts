/**
 * Removes the line breaks `deno fmt` wraps Japanese prose at.
 *
 * Markdown turns a soft line break into a space, which is right between two English words and
 * wrong between two Japanese characters: `か。\n合法か` would render as `か。 合法か`. `deno fmt`
 * also re-wraps paragraphs and leaves such a space in the source. A break or spaces between two
 * non-ASCII characters are dropped; next to Latin text they stay a space, which is how this site
 * sets Latin inside Japanese anyway. Fenced code is left alone.
 *
 * @param markdown The Markdown body
 * @returns The same Markdown with those breaks joined
 */
export function joinJapaneseLines(markdown: string): string {
  return markdown
    .split(/(^```[^\n]*\n[\s\S]*?^```$)/m)
    .map((part, i) =>
      i % 2 === 1 ? part : part.replace(
        /([^\p{ASCII}])[ \t]*(?:\n[ \t]*)?(?=[^\p{ASCII}])/gu,
        "$1",
      )
    )
    .join("");
}
