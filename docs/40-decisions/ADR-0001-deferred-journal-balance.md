---
status: 採用
decided: 2026-11-01
verified: 2026-11-24 @ 2e76288
code: [supabase/schema.sql, supabase/manual-migrations/20261101180100_enforce_journal_balance.sql, supabase/manual-migrations/20261101180100_enforce_journal_balance.test.sql]
related: [README.md, ADR-0002, ../20-database/triggers-constraints.md]
---

# ADR-0001 借貸一致を遅延制約で保証する


## 背景

仕訳の借貸一致は複数の明細にまたがる。画面以外からヘッダーや明細を書き込む場合も、借貸が崩れた仕訳が確定しない仕組みが必要だった。

## 決定

遅延制約トリガーをヘッダーの追加と明細の追加・更新・削除に付ける。既定ではコミット時に、仕訳に明細が2行以上あり、借方・貸方が各1行以上で、借貸合計が一致することを検査する。同じ仕訳の明細変更は親の仕訳行のロックで直列化する。

## 検討して採らなかった案

画面や保存RPCの事前検査だけで保証する方式では、テーブルへの直接書き込みを検査できない。

## 採用理由

編集中に既存明細を削除してから新しい明細を登録することがある。トランザクションの最終状態で検査すれば、その途中の不一致を許容しながら、結果が不正なコミットを拒否できる。

## 影響・制約

新規のヘッダーと明細は同じトランザクションで保存する。画面の事前検査も残し、入力時にエラーを知らせる。

## 根拠

変更SQLとテストは、ヘッダーだけの追加、借貸不一致、同じ仕訳への明細変更を扱う。 [変更SQL](../../supabase/manual-migrations/20261101180100_enforce_journal_balance.sql) [SQLテスト](../../supabase/manual-migrations/20261101180100_enforce_journal_balance.test.sql)
