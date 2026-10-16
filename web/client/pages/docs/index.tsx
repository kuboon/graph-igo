/**
 * The list of explanations.
 *
 * It is handed the articles rather than reading them: `server/docs/` owns the files, this owns the
 * screen. What it renders still decides what the site contains, though: the crawl writes what
 * something links to, so an article missing from this list is an article missing from `dist/`.
 */

import { css, type Handle } from "@remix-run/component";

import { routes } from "../../routes.ts";
import { color } from "../../tokens.ts";

/** What the listing needs of an article. The server reads more than this and passes it along. */
export interface ArticleSummary {
  /** The article's URL segment. */
  slug: string;
  title: string;
  summary: string;
}

export const title = "解説 — graph-igo";
export const description =
  "グラフ囲碁のルールと、エンジン・CPU の wasm モジュールのしくみ。";

/** A list of links and nothing else. */
export const hydrate = false;

/**
 * @param handle The articles, in the order they should be listed
 * @returns The listing
 */
export default function DocsIndex(
  handle: Handle<{ articles: readonly ArticleSummary[] }>,
) {
  return () => (
    <>
      <h1>解説</h1>
      <ul mix={listStyle}>
        {handle.props.articles.map((article) => (
          <li key={article.slug}>
            <a
              mix={titleStyle}
              href={routes.docs.show.href({ slug: article.slug })}
            >
              {article.title}
            </a>
            <p mix={summaryStyle}>{article.summary}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- styles -----------------------------------------------------------------

const listStyle = css({
  listStyle: "none",
  padding: 0,
  "& li": {
    paddingBlock: "1rem",
    borderBottom: `1px solid ${color.border}`,
  },
});

const titleStyle = css({ fontSize: "1.2rem", fontWeight: 600 });

const summaryStyle = css({ marginBlock: "0.3rem 0" });
