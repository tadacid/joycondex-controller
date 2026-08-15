# JoyCondex

片手でCodexを操作するための親プロジェクトです。

このリポジトリでは、入力デバイスごとの実装を分離しつつ、将来的にCodex操作・安全制御・音声入力・Agent選択などを共通化します。

- **Joy-Con 2版**: 先に操作感を検証するソフトウェアPoC。現在ここが動作実装済み。
- **M5Stack版**: Joy-Con 2版で検証したUXを専用ハードへ落とし込む本命デバイス。現在は設計段階。

**Joy-Con + Codex = JoyCondex**。Joy-Con 2からCodexを操作するコントローラーです。

## Codexで続きを始める

Codexには**この `joycondex-controller` フォルダを丸ごと開かせてください**。

最初に読むファイル:

1. `AGENTS.md`
2. `docs/CURRENT_STATE.md`
3. `docs/ARCHITECTURE.md`
4. `docs/JOYCON_NEXT_STEPS.md`
5. 必要に応じて `docs/M5_HARDWARE_PLAN.md`

Joy-Con 2版をまず実機確認する場合:

```bash
npm test
```

その後、Macで:

```bash
./START_JOYCON_DRY_RUN.command
```

問題なければ:

```bash
./START_JOYCON_LIVE.command
```

普段は、Applicationsフォルダの`JoyCondex.app`をダブルクリックします。未起動ならLIVEコントローラーを起動し、起動済みならダッシュボードを開きます。

## 現在のJoy-Con 2操作

| Joy-Con 2 | JoyCondex |
|---|---|
| R 押下/解放 | VoiceKey音声入力 開始/終了 |
| ZR | 机上では左クリック、持ち上げ中はメイン／サイド入力欄切替 |
| A | ACTION / 送信 |
| B 短押し/長押し | 1文字DELETE / 入力欄を全文削除 |
| X 短押し/長押し | Escape・戻る / 最新メッセージへ移動 |
| Y | 新規チャット |
| HOME / C | 前／次のタスクへ移動 |
| SR / SL | 推論レベル 上／下 |
| Stick | 持ち上げ中のカーソル移動 |
| + 短押し/長押し | ボイスモード / MASTER ENABLE・DISABLE |

詳細は `apps/joycon2/controller/README.md` を参照してください。

音声入力は、Macで起動中のVoiceKeyへローカルの開始・停止命令を送り、Rを押している間だけ録音します。Optionキーの手動操作はそのまま利用できます。

`http://127.0.0.1:8788/` の設定画面では、DISABLED中にボタン割当、マウス操作ON/OFF、Stick・机上マウス速度、振動通知のON/OFFと強さを変更できます。設定はJSONへバックアップ・復元でき、再起動後も維持されます。Codexの作業完了は長い振動を1回、ユーザー操作が必要な承認待ちは長い振動を3回送ります。自動審査の承認要求では振動しません。通知だけはDISABLED中も動きます。バッテリー欄には電圧から計算した残量目安メーターを表示し、3.55V以下では画面とMac通知で充電を促します。

## 方針

Joy-Con 2とM5Stackで異なるのは、できるだけ**物理入力層だけ**にします。

```text
Joy-Con 2 ─┐
            ├─> Semantic Actions ─> Mac/Codex control
M5Stack  ──┘
```

たとえば現在の `R` とM5版の物理トリガーは、どちらも最終的には `TALK_START / TALK_STOP` を発生させる設計にします。
