---
status: 現行
verified: 2026-11-24 @ faa8f95
code: [README.md, SECURITY.md, CONTRIBUTING.md, LICENSE, NOTICE, .gitignore, package.json, package-lock.json, .github/workflows/test.yml, scripts/check-docs.mjs]
related: [README.md, ../40-decisions/ADR-0013-apache-license.md, ../40-decisions/ADR-0014-clean-public-repository.md, ../40-decisions/ADR-0015-source-before-hosted-demo.md, ../60-testing/README.md, ../60-testing/vitest-and-ci.md]
---

# ソースを公開する手順

初回は整理済みのリポジトリからソースコードを公開します。閲覧専用デモや認証付きのアプリは、別の段階で設計・検証する方針です。 [公開用リポジトリの設計判断](../40-decisions/ADR-0014-clean-public-repository.md)・[公開の順序](../40-decisions/ADR-0015-source-before-hosted-demo.md)

## 公開・更新の準備

1. 公開するコミットを確定し、変更点と既知の制約を整理します。READMEの利用範囲、`LICENSE`・`NOTICE`、同梱フォントのライセンス、報告窓口の案内を確認します。 [利用上の注意](../../README.md)・[セキュリティの連絡方法](../../SECURITY.md)
2. 対象コミットで `npm test`、`npm run typecheck`、`node scripts/check-docs.mjs` とその `--drift` を実行し、結果を記録します。DB・画面の変更がある場合は、影響した経路のSQLテストとブラウザー確認を追加します。 [テストの考え方](../60-testing/README.md)
3. 初回公開前には、公開対象の追跡ファイルとGit履歴を点検します。環境設定、接続情報、個人情報、ダンプ、実データを含むCSVや画像、内部の報告書が含まれていないことを確認します。`.gitignore` に設定があっても、既に追跡されたファイルや履歴は別に点検します。 [公開用リポジトリの設計判断](../40-decisions/ADR-0014-clean-public-repository.md)
4. 公開対象のREADMEやリリースの案内で、現在使える機能と既知の制約を照合します。初回の公開では、架空データでの試用に限ることと、公開URLへの配置を避けることを確認します。 [利用上の注意](../../README.md)

## 公開直前の確認

公開範囲を切り替える直前に、次を確認します。準備の段階から時間が空いた場合は、結果が変わっていることがあります。

1. **公開するコミット**: `git fetch origin` のうえ、公開するコミットがリモートの `main` の先頭であることを確認します。ローカルにだけ残る変更が公開内容と混ざっていないことも見ます。GitHubで、そのコミットに対する `main` のCI（`test`）が成功していることを確認します。 [テストとCI](../60-testing/vitest-and-ci.md)
2. **依存関係の脆弱性**: `npm audit --omit=dev`（実行時に使われる依存）と `npm audit`（開発時を含む依存）を実行し、GitHubのDependabot alertsで開いている件数も確認します。READMEの「依存関係の脆弱性について」の節の日付・件数・内容と食い違う場合は、公開前にREADMEを更新します。「報告なし」は依存パッケージの既知の脆弱性の確認結果であり、アプリ自体の安全性を示すものではないことを、節の文面で保ちます。 [README](../../README.md)
3. **GitHubのリポジトリ設定**: 現在の方針と照合します。
   - Issuesが有効であること。
   - Pull requestsが無効であること。受け付けない方針は [CONTRIBUTING.md](../../CONTRIBUTING.md) にあります。
   - Dependabotのsecurity updatesとversion updatesが無効であること。リポジトリに `dependabot.yml` は置いていません。アラートの通知と `npm audit` で確認する方針です。
   - 公開範囲の切り替え前は、Private vulnerability reportingを選べません。この項目は公開後の確認に回します。

   設定画面の状態はファイルから確認できないため、公開のたびに画面で見ます。
4. **追跡ファイルと履歴の再走査**: 準備の段階の点検を、公開直前の状態にもう一度かけます。対象は、現在の追跡ファイルと、公開する全コミットの履歴（全ブランチ）です。検索する語の種類は次のとおりです。
   - 個人のパス、メールアドレス、端末名
   - 鍵・トークン・秘密鍵の形式
   - 接続文字列、プロジェクトを特定できるURLやID
   - 公開しない資料や運用への言及

   コミットの作者・コミッターの表示が、公開してよい名前とアドレスであることも確認します。見つかった場合は公開せず、原因を取り除いてからやり直します。
5. **リモートのブランチ**: `git ls-remote --heads origin` で、リモートのブランチが `main` だけであることを確認します。公開すると、リモートにある全ブランチとその履歴が閲覧できます。作業用や自動生成のブランチが残っていれば、内容を確認して削除します。タグも同様に確認します。

## 初回公開と直後の確認

公開前の点検を終えたリポジトリは、GitHubで公開範囲を切り替えます。

- **セキュリティ設定は、公開と同じ作業の中で続けて有効にします。** [SECURITY.md](../../SECURITY.md) は、リポジトリの「Security」タブからの非公開報告を案内しています。Private vulnerability reportingが有効になるまで、この窓口は使えません。**Private vulnerability reporting**、**Secret scanning**、**Push protection** が有効であることを確認し、無効な項目は有効にします。 [非公開の脆弱性報告の設定](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)・[リポジトリのセキュリティ設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
- 公開ページを、ログインしていない状態で確認します。対象のソース、READMEの表示と冒頭の警告、`LICENSE`、`SECURITY.md` とその「Report a vulnerability」への導線、報告窓口へのリンクが閲覧できることを見ます。
- Issuesが動作することを確認します。新規Issueを作成できる画面が開くこと、Pull requestsが使えない状態であることを見ます。確認用に作ったIssueは、確認後に閉じます。
- 以後の更新でも、公開内容、検証結果、利用上の制約をリリースの記録に残します。 [不具合や提案の報告](../../CONTRIBUTING.md)

## 問題が見つかったとき

- **公開範囲をPrivateに戻しても、一度公開した履歴は取り消せません。** 公開中に複製されたり、キャッシュや検索に残ったりしている可能性があります。公開した内容は、取り消せないものとして扱います。
- **秘密情報を公開した場合は、履歴を書き換える前に、該当する鍵・トークン・パスワードを無効にして作り直します。** 無効にしたものは、書き換え後も、公開済みの履歴から使えるためです。接続先のサービスで、不正な利用がないかも確認します。
- 履歴の書き換え（該当コミットの除去と強制的な更新）を検討する場合は、次に注意します。
  - 既にある複製やforkには、書き換え前の履歴が残ります。
  - 過去のコミットのURLや、GitHubのキャッシュに内容が残ることがあります。必要に応じて、GitHubのサポートへの削除依頼を検討します。
  - 書き換えは秘密情報の無効化の代わりになりません。
- 個人情報や非公開の資料が含まれていた場合も、取り除いたうえで、公開した範囲と影響を記録します。原因を確認し、準備の段階の点検の手順を見直します。
