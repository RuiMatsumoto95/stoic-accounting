---
status: 採用
decided: 2026-11-07
verified: 2026-11-24 @ 2e76288
code: [lib/ime-free-input.ts, components/journals/DateInput.tsx, components/journals/AccountCombobox.tsx, components/journals/InlineJournalForm.tsx, components/journals/InlineEditRow.tsx, __tests__/ime-free-input.test.ts]
related: [README.md, ../30-features/journals.md]
---

# ADR-0011 日付・科目・金額をIMEに依存せず入力する


## 背景

仕訳を連続入力する際、日付・科目・金額では数字やローマ字を、摘要では日本語を使う。通常の入力欄ではIMEがTabやEnterを変換操作に使うことがあり、欄間の移動も影響を受けた。

## 決定

下部の仕訳入力欄と一覧内の編集で、日付・科目・金額を読み取り専用の入力部品にし、キーボードイベントから必要な文字や操作を反映する。摘要・補足には通常のテキスト欄を使う。

## 検討して採らなかった案

- フォーカスが摘要欄に移ったときにWebアプリからIMEを自動で切り替える案。調査では、その切り替えを制御できなかった。
- 金額欄を `type="number"` にする案。実機確認では金額欄を通過すると、日本語入力が摘要に引き継がれない場合があった。

## 採用理由

必要な欄だけキーを直接扱えば、日本語入力を有効にしたまま日付や金額を入力し、摘要で日本語入力を続けられる。入力欄ごとに手動でIMEを切り替える手間も省ける。

## 影響・制約

この入力方式は物理キーボード向け。該当欄での貼り付け、途中位置への文字挿入、科目の日本語名による検索は対象外。複合仕訳フォームと伝票番号欄には、この方式を共通適用していない。

## 根拠

2026-11-07のIME比較記録で、読み取り専用の欄を通った後も摘要で日本語入力を続けられることを確認した。現行テストはキーから文字への変換を検査する。 [キー処理](../../lib/ime-free-input.ts) [単体テスト](../../__tests__/ime-free-input.test.ts)
