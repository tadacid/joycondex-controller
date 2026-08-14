# Repository Reorganization

このZIPでは、既存の動作コード自体は極力変更せず、フォルダだけ親プロジェクト構造へ整理しました。

旧:

```text
joycon2-bridge/
codex-controller/
kirari-reference/
```

新:

```text
apps/joycon2/bridge/
apps/joycon2/controller/
docs/references/kirari/
```

ControllerのBridge接続は `http://127.0.0.1:8787/events` なので、コード内の相対パス変更は不要です。

ルートの `.command` 起動ファイルだけ新しい配置へ合わせて更新しています。
