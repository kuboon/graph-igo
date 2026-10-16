# graph-igo

任意のグラフ上で打つ囲碁。ルールエンジンと CPU を Rust で書き、それぞれ別の wasm
モジュールにして、`web/` (Remix v3 + Deno、**static モード** = GitHub Pages
のみ、client only) で遊べるようにしている。

`deno-remix-tmpl` から作った派生アプリ。ステップ 0 (static モード) とステージ 1
は済み。ステージ 2 は一部済み (hydration-demo・showcase・spa を削除、blog は解説
`docs` に転用)。fullscreen・helper・signin・push はまだ残っている。

## このリポジトリは何か（最初に判定する）

このリポジトリは **GitHub
テンプレート**で、ここから新しいアプリを作る。ファイルは全部コピーされるので、
同じ `CLAUDE.md` が **テンプレ本体**と**派生アプリ**の両方にある。次で区別する。

1. `git remote get-url origin` が `kuboon/deno-remix-tmpl` →
   **テンプレ本体**。「テンプレ本体を保守するとき」を読む。
2. それ以外 → **派生アプリ**。`TEMPLATE.md` が残っていれば、init 前なので **まず
   `TEMPLATE.md` の ステップ 0 とステージ 1 を済ませる**。`TEMPLATE.md`
   が無ければ init 済みで、普通のアプリとして扱う
   （テンプレ本体の事情は持ち込まない）。

判定できない（remote が無い等）ときは、推測せずユーザーに聞く。

## テンプレ本体を保守するとき

（派生アプリでは、init の最後にこの節を削除する。）

- 方針: **機能は全部このテンプレに置く**。別の starter に機能を分散させない（旧
  SSG starter
  の機能もここに統合済み）。派生アプリが要らない機能を消せるよう、`TEMPLATE.md`
  の機能表と `[feature:名前]` タグを **機能を足す/消す/動かすたびに更新する**。
- 機能を足したら: 配線行（`routes.ts` / `router.tsx` / `layout.tsx` /
  `assets.ts`）に `[feature:名前]` を付け、 `TEMPLATE.md`
  の表に行（消すファイル・配線・依存）を足す。
- 二つのモードが両方動くことを保つ: static（SSG → Pages）と server（Deno
  Deploy）。 デモは両方の URL を `README.md`
  とトップページに載せている。`/api/*` を static に出さない
  （どこからもリンクしない、`entryPoints` に入れない）。
- 変更前後に `deno task check && deno task test && deno task build` と
  `deno task test:browser` を通す。 `TEMPLATE.md`
  の削除リストが本当に通るか、確かめるには scratch の `git worktree` で static
  用と server 用の リストをそれぞれ実際に消して `check`/`build`(`test`) を回す。
- `@remix-run/render-middleware` は 1.0.0 で固定を外した （`TEMPLATE.md`
  参照）。依存を上げたら `/docs` の本文を確認する。

## 構造

- `wasm/` — Rust の cargo workspace。`rust-toolchain.toml` が wasm32 target
  を入れる。
  - `core/` (`graph-go-core`) — 共通のルールブック。グラフ (CSR
    隣接)、盤面と着手 (取り・コウ・自殺手)、空き領域の抽出と部分グラフ化、JSON
    の wire 型 (`wire.rs`)、wasm の呼び出し規約 (`abi.rs`)。
  - `engine/` → `engine.wasm`: `play` (次の 1 手で何が起きるか)、`regions`
    (空きが n 以上連なる部分グラフ)、`evaluate` (部分グラフを CPU の `judge`
    に投げて地を数える。CPU は import `cpu.judge` / `cpu.take_response`
    経由で呼ぶ)。
  - `cpu/` → `cpu.wasm`: `judge` (部分グラフが黒白どちらの地か)、`genmove`
    (原始モンテカルロ)、`solve` (詰碁の読み:
    連を深さ以内に取れるか。`solve.rs`)。`core`
    をリンクしているので同じルールでプレイアウトする。
  - `graph_go_test.ts` — 両 wasm を JS ローダー越しに叩く Deno テスト。
- 呼び出し規約: JSON を `alloc` したメモリに書き、`fn(ptr, len)` が返す長さ分を
  `result_ptr()` から読む。失敗は trap ではなく `{"error": "..."}`。 色は `0` 空
  / `1` 黒 / `2` 白、`null` の着手はパス。
- `web/client/lib/graph_go/` — `wasm.ts` (ロードと engine→CPU
  の接続)、`types.ts` (wire 型の TS 版。`wire.rs` を変えたらここも)、`graphs.ts`
  (盤のプリセット:
  正方格子・三角格子・蜂の巣・同心円・ランダムなガブリエルグラフ)。
- `web/client/lib/graph_go/board_view.tsx` — 盤の SVG。両 island が使う。
- `web/client/lib/graph_go/problems.ts` — 詰碁。`tools/gen_tsumego.ts`
  がランダムな局面から読みで「急場で、正解の初手がちょうど 1 つ」のものを選んで
  生成する。`wasm/graph_go_test.ts` が全問の正解の一意性を確かめる。
- ページ: `/` (詰碁と対局への入口)、`/play` (`islands/graph_go.tsx`)、`/tsumego`
  (`islands/tsumego.tsx`)、`/docs` (解説)。
- 解説は `web/server/docs/*.md` (front-matter の `title` / `order` /
  `summary`)。 `server/docs/mod.tsx` が `@kuboon/md` で描画する。`deno fmt`
  が日本語の段落を 折り返すので、描画前に日本語どうしの改行を詰めている
  (`japanese.ts`)。
- wasm は `deno task build:wasm` が `web/client/static/wasm/` に出す (git
  管理外)。`dev` / `serve` / `build` / `test` はこれに依存しているので先に走る。
  静的ビルドは `router.tsx` の `entryPoints` で `.wasm` を拾う (スクリプトから
  fetch するだけでリンクされないため)。
- テンプレ由来の `web/` — `web/client/` はブラウザに渡るもの全て (routes / pages
  / islands / layout / static、`deno.ns` 無しで型チェック)、`web/server/` は
  router・asset bundler・解説の Markdown・og 画像 (静的ビルドのためだけにある)。
  `/my` (id.kbn.one サインイン + push 通知) などのデモはまだ残っている。

## デプロイ (GitHub Pages)

`.github/workflows/pages.yml` が `mise run build` → `deno task build`
(`build:wasm` → `@remix-kbn/ssg`) を走らせ、router を `fetch()` でクロールして
`web/dist` に書き出す。main は Pages ルート、PR は preview サブパス (`BASE_URL`
から `base` が決まる)。CI ランナーの rustup が `rust-toolchain.toml` に従って
wasm32 target を入れる。

## 環境変数

- `BASE_URL` — 静的ビルド専用。Pages のサブパス（PR プレビュー等）を `base`
  にする。

## 開発

```bash
deno task dev        # wasm をビルドしてから web の開発サーバー起動
deno task build:wasm # engine.wasm / cpu.wasm だけビルド
deno task build      # GitHub Pages 用の静的サイトを web/dist へ生成
deno task test       # wasm + web の Deno テスト
deno task test:wasm  # Rust のユニットテスト (cargo test)
deno task test:browser  # ブラウザ smoke テスト (lightpanda)
deno task check      # 型チェック + lint + fmt
```

## コーディング規約

- Deno ファースト（Web API 優先、Node.js API は必要最小限）
- TypeScript strict mode
- テストは `Deno.test()` + `@std/assert`
- ファイル名はスネークケース（例: `dpop_test.ts`）
- ページ/island の見た目は `@remix-run/component` の `css()` mixin と
  `web/client/tokens.ts` のトークンで書く (Tailwind / daisyUI は使わない)
- ブラウザへ渡るコードは `web/client/` に置き、`Deno.` を参照しない
