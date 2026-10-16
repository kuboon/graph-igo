# graph-igo

任意のグラフの上で打つ囲碁。ルールエンジンと CPU はそれぞれ Rust 製の wasm
モジュールで、ブラウザだけで動く。

- デモ (GitHub Pages): <https://kuboon.github.io/graph-igo/> — 詰碁と対局
- `wasm/engine` — `play` (次の 1 手で何が起きるか) / `regions` (空きが n
  以上連なる部分グラフ) / `evaluate` (部分グラフを CPU に判定させて数える)
- `wasm/cpu` — `judge` (部分グラフが黒白どちらの地か) / `genmove`
  (原始モンテカルロ)
- [GameCenter](https://ga-cen.kbn.one) の実績に対応
  (`web/client/game_center.ts`)
- `web/` — 遊ぶページ (Remix v3 + Deno、静的サイト)

```bash
deno task dev   # rustup と Deno があれば、wasm をビルドしてから起動
```

開発のルールは
[CLAUDE.md](./CLAUDE.md)。[deno-remix-tmpl](https://github.com/kuboon/deno-remix-tmpl)
から作成 (init 手順は [TEMPLATE.md](./TEMPLATE.md))。
