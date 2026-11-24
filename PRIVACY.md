# Privacy Policy — Input Audit

**Privacy Policy for Input Audit (version 0.4.0)**

Last updated: 25 November 2026

Input Audit is a local audit tool for web input. It does not operate any server.

**What the extension records**

- By default, the extension records metadata only about input, paste, and submit events in the
  browser (such as when an event happened and on which page).
- On websites you explicitly allow (the allowlist you manage in the popup), it also records the
  values you entered, their edit history, and a snapshot of the form at submit time, so you can
  review the list before sending.
- If you import source data for the cross-check (paste, clipboard, or a CSV file, in the side
  panel), that source data and its field mappings are also stored — in the same local storage,
  and never sent to the website or anywhere else.
- Password fields are never recorded — not the value, not even its length.

**Where your data lives**

- All data is stored only in your browser's local storage (`chrome.storage.local`). It is never
  sent to any server, and the extension makes no network requests with your data.
- There is no account, no analytics, and no data shared with any third party.

**Your control**

- You can turn logging and the pre-submit gate on or off from the popup.
- You can add or remove allowlisted sites at any time.
- You can review the log in the popup and delete all entries. Deleting cannot be undone.
- Imported source data can be deleted per site from the side panel.

**Contact**

Questions about this policy: please open an issue at
https://github.com/matdonaruno/Browser-incident-check

---

# プライバシーポリシー — 入力監査ログ (Input Audit)

**入力監査ログ (Input Audit) プライバシーポリシー（バージョン 0.4.0）**

最終更新: 2026年11月25日

入力監査ログは、ブラウザでの入力をローカルで監査するツールです。運営するサーバーはありません。

**記録するもの**

- 既定では、ブラウザでの入力・貼り付け・送信について、メタデータのみを記録します
  （いつ・どのページで起きたか等）。
- ポップアップで許可したサイト（許可リスト）に限り、入力値・修正履歴・送信時のスナップショットも
  記録し、送信前に一覧で確認できるようにします。
- 照合用の元データをサイドパネルから取り込んだ場合（貼り付け・クリップボード・CSVファイル）、
  その元データと項目の対応づけも同じローカルストレージに保存します。サイトや外部へ送ることは
  一切ありません。
- パスワード欄は記録しません。値だけでなく長さも記録しません。

**データの置き場所**

- すべてのデータはブラウザのローカルストレージ（`chrome.storage.local`）にのみ保存します。
  外部サーバーへの送信は一切行わず、データを含むネットワーク通信もしません。
- アカウント、解析、第三者へのデータ提供はありません。

**ユーザーの管理**

- ポップアップから記録と送信前ゲートのオン／オフができます。
- 許可サイトの追加・削除はいつでもできます。
- ログはポップアップで確認でき、全削除もできます。削除は元に戻せません。
- 取り込んだ元データは、サイドパネルからサイト単位で削除できます。

**連絡先**

このポリシーについての質問は https://github.com/matdonaruno/Browser-incident-check の Issue へ。
