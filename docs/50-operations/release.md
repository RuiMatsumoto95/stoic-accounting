---
status: 現行
verified: 2026-11-24 @ 47e0a78
code: [README.md, SECURITY.md, CONTRIBUTING.md, LICENSE, NOTICE, .gitignore, .github/workflows/test.yml, scripts/check-docs.mjs]
related: [README.md, ../40-decisions/ADR-0013-apache-license.md, ../40-decisions/ADR-0014-clean-public-repository.md, ../40-decisions/ADR-0015-source-before-hosted-demo.md, ../60-testing/README.md]
---

# ソースを公開する手順

初回は整理済みのリポジトリからソースコードを公開します。閲覧専用デモや認証付きのアプリは、別の段階で設計・検証する方針です。 [公開用リポジトリの設計判断](../40-decisions/ADR-0014-clean-public-repository.md)・[公開の順序](../40-decisions/ADR-0015-source-before-hosted-demo.md)

## 公開・更新の準備

1. 公開するコミットを確定し、変更点と既知の制約を整理します。READMEの利用範囲、`LICENSE`・`NOTICE`、同梱フォントのライセンス、報告窓口の案内を確認します。 [利用上の注意](../../README.md)・[セキュリティの連絡方法](../../SECURITY.md)
2. 対象コミットで `npm test`、`npm run typecheck`、`node scripts/check-docs.mjs` とその `--drift` を実行し、結果を記録します。DB・画面の変更がある場合は、影響した経路のSQLテストとブラウザー確認を追加します。 [テストの考え方](../60-testing/README.md)
3. 初回公開前には、公開対象の追跡ファイルとGit履歴を点検します。環境設定、接続情報、個人情報、ダンプ、実データを含むCSVや画像、内部の報告書が含まれていないことを確認します。`.gitignore` に設定があっても、既に追跡されたファイルや履歴は別に点検します。 [公開用リポジトリの設計判断](../40-decisions/ADR-0014-clean-public-repository.md)
4. 公開対象のREADMEやリリースの案内で、現在使える機能と既知の制約を照合します。初回の公開では、架空データでの試用に限ることと、公開URLへの配置を避けることを確認します。 [利用上の注意](../../README.md)

## 初回公開と直後の確認

公開前の点検を終えたリポジトリは、GitHubで公開範囲を切り替えます。

- 公開ページで対象のソース、README、ライセンス、報告窓口へのリンクが閲覧できることを確認します。
- リポジトリの **Private vulnerability reporting**、**Secret scanning**、**Push protection** が有効であることを確認し、無効な項目は有効にします。 [非公開の脆弱性報告の設定](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)・[リポジトリのセキュリティ設定](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
- 以後の更新でも、公開内容、検証結果、利用上の制約をリリースの記録に残します。 [不具合や提案の報告](../../CONTRIBUTING.md)
