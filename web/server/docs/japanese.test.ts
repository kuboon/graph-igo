import { assertEquals } from "@std/assert";

import { joinJapaneseLines } from "./japanese.ts";

Deno.test("joinJapaneseLines joins wrapped Japanese and leaves the rest", () => {
  assertEquals(joinJapaneseLines("か。\n合法か"), "か。合法か");
  assertEquals(joinJapaneseLines("か。 合法か"), "か。合法か");
  assertEquals(joinJapaneseLines("1 手"), "1 手");
  assertEquals(joinJapaneseLines("- 一行目\n  の続き"), "- 一行目の続き");
  assertEquals(joinJapaneseLines("wasm32\nにビルド"), "wasm32\nにビルド");
  assertEquals(joinJapaneseLines("段落。\n\n次の段落"), "段落。\n\n次の段落");
  const fence = "```\n日本\n語\n```";
  assertEquals(
    joinJapaneseLines(`前\n置き\n\n${fence}\n`),
    `前置き\n\n${fence}\n`,
  );
});
