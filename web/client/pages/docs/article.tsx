/**
 * One explanation.
 *
 * The body arrives already rendered, from `server/docs/` — this places it and dresses it with
 * `proseStyle`, which is the one mixin that reaches into markup it did not write.
 */

import { css, type Handle, type RemixNode } from "@remix-run/component";

import { routes } from "../../routes.ts";
import { proseStyle } from "../../theme.ts";

export interface ArticleProps {
  /** What the page shows of the article itself — its front-matter, as far as this needs it. */
  article: { title: string };
  /** The Markdown body, already a node tree. */
  body: RemixNode;
}

/** Text and links only. */
export const hydrate = false;

/**
 * @param handle The article's front-matter, and its rendered body
 * @returns The article page
 */
export default function DocsArticle(handle: Handle<ArticleProps>) {
  return () => {
    const { article, body } = handle.props;

    return (
      <article mix={proseStyle}>
        <h1>{article.title}</h1>
        {body}
        <p mix={footerStyle}>
          <a href={routes.docs.index.href()}>← 解説の一覧</a>
        </p>
      </article>
    );
  };
}

const footerStyle = css({ marginTop: "2.5rem" });
