# web/tests — ブラウザ smoke

opt-in のブラウザテスト。デフォルトの `deno task test`
には含まれず、`deno
task test:browser` で明示的に起動する。 lightpanda
バイナリは npm:@lightpanda/browser の postinstall scriptでビルドされる。

## 前提

- ルーターは起動時に `Deno.bundle` で client を bundle する
  (`web/server/assets.ts`)。wasm は `deno task test:browser` が先に `build:wasm`
  で作る。

## 実行

```bash
deno task test:browser    # root から
```

## カバー範囲

- `browser_tsumego.test.ts` — `/tsumego` を開き、`globalThis.__rmxReady` が立ち
  wasm が読み込まれるまで待ってから、最初の問題の正解の点をクリックし、 CPU
  の応手 (「続けて」か「正解」) が表示される事を assert する。SSR → island の
  hydrate → wasm の fetch と instantiate → engine と CPU の呼び出し、の
  フル経路を exercise する。
