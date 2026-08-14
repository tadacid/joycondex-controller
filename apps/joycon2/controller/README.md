# Joy-Con 2 → Codex Controller V0

`../bridge` が配信するSSEを受け、右Joy-Con 2からmacOS版ChatGPT/Codexを安全寄りに操作する試作です。
Bridge本体は原則変更しません。

## V0の割り当て

| Joy-Con 2 (R) | 操作 |
| --- | --- |
| `R`を押す／離す | VoiceKey録音開始／終了 |
| `ZR` | 机上ではマウス左クリック、持ち上げ中はメイン／サイド入力欄を切替 |
| Stick押込 | マウス左クリック |
| `A` | 入力欄の文章を送信 |
| `B`短押し / 長押し | 1文字DELETE / 入力欄を全文削除 |
| `Y` | 新規Codexチャット |
| `X`短押し / 長押し | Escape・戻る / 最新メッセージまで移動 |
| `HOME` | 左サイドバーの前のチャットへ移動 |
| `C` | 左サイドバーの次のチャットへ移動 |
| `SR` | 推論レベルを上げる |
| `SL` | 推論レベルを下げる |
| Stick | マウス操作ON時は、Joy-Conを持ち上げてカーソル移動 |
| `+`短押し | ボイスモード開始／停止（`Control+Option+V`） |
| `+`を0.8秒長押し | コントローラーを有効／停止 |

## 安全機構

- 起動・再接続後、一度すべてのボタンとStickがニュートラルになるまで無効
- `+`長押しで明示的にARMEDにしない限り操作しない
- 切断、SSE停止、入力Watchdogで自動的にDISABLEDへ戻る
- ボタンは `false → true` の瞬間だけ発火し、長押し連打しない
- Stickは中央へ戻るまで同じ方向を再発火しない
- `A`送信はARMED中かつChatGPT/Codexが前面の時だけ許可
- 音声入力終了後は文字起こし確定待ちを入れてから送信可能にする
- DISABLEDへ戻った後は、キュー済み通常操作も実行しない
- Bridge/SSE切断、watchdog、MASTER停止、Controller終了時はVoiceKeyを停止
- Controllerが開始を受け付けたVoiceKey録音だけを停止対象として扱う
- 送信・消去・チャット移動はChatGPT/Codexが前面の場合だけ実行
- Bridge本体には書き込みAPIを追加していない

## 推奨: repoルートから起動

まずDRY RUN:

```bash
./START_JOYCON_DRY_RUN.command
```

実操作:

```bash
./START_JOYCON_LIVE.command
```

デバッグUIは `http://127.0.0.1:8788/`。

## 手動起動

Terminal 1:

```bash
cd apps/joycon2/bridge
npm run start
```

Terminal 2:

```bash
cd apps/joycon2/controller
npm run start:dry
```

LIVEの場合は `npm run start`。

## 設定

実際の設定は`config.json`へ保存されます。このファイルは端末ごとの設定なのでGit管理外です。初期値の一覧は`config.example.json`を参照してください。Bridge URL、UIポート、Stick閾値、ARMED長押し時間などを変更できます。

デバッグUIの「Button / Mouse settings」では、DISABLED中に音声入力、ボイスモード、送信、DELETE、新規、前面化、Escape・戻る、タスク選択 上／下、推論レベル 上／下、入力欄切替／机上クリック、マウスクリックとマウス操作ON/OFFを変更できます。同じ機能を複数ボタンへ割り当てられます。保存後は全ボタンを一度離し、再度`+`を長押しします。`+`短押しはボイスモード、長押しは安全用MASTERです。

HOME/Cは`Control+Tab`を使いません。タブ切替と競合しない専用ショートカットをCodex側に設定し、コマンド検索画面を開かずに左サイドバーのスレッドを移動します。SR/SLも専用ショートカットで推論レベルを変更します。いずれも画面座標やクリップボードは使いません。

Codex側の専用割当は`~/.codex/keybindings.json`に保存します。

| Codex操作 | 専用ショートカット |
| --- | --- |
| 左サイドバーの前のチャット | `Control+Option+Shift+↑` |
| 左サイドバーの次のチャット | `Control+Option+Shift+↓` |
| 推論レベル上 | `Control+Option+Shift+→` |
| 推論レベル下 | `Control+Option+Shift+←` |

マウス操作ON時は、Joy-Conを机に置くと光学センサー、持ち上げるとStickへ自動で切り替わります。ZRは机上センサーモードでは左クリック、持ち上げ中はmacOSのアクセシビリティ情報でメイン／サイド入力欄を交互に切り替えます。座標や入力本文は使用しません。Stick押込はどちらのモードでも左クリックです。切替直後の値と大きな飛び値は無視します。マウス操作OFF時のみ、Stick左右は従来どおり前後チャット移動です。

選択可能: `ZR / A / B / X / Y / R / C / HOME / + / Stick押込 / SL / SR`

VoiceKeyは起動済みの状態で、Controllerから次を呼びます。

```text
POST http://127.0.0.1:47321/start
POST http://127.0.0.1:47321/stop
```

環境変数:

```bash
CODEX_CONTROLLER_DRY_RUN=1
CODEX_CONTROLLER_PORT=8788
JOYCON_BRIDGE_URL=http://127.0.0.1:8787/events
CODEX_CONTROLLER_CONFIG=/path/to/config.json
```

## テスト

repoルートから:

```bash
npm test
```

またはこのフォルダで:

```bash
npm test
```

状態機械、VoiceKey開始・停止、ボタン設定保存、ニュートラルゲート、切断時停止などをテストします。

## 実機で最初に確認する項目

1. Rを押している間だけVoiceKeyが録音し、解放後にCodexへ貼り付けるか
2. 音声入力後、composerにフォーカスが残るか
3. Aで送信されるか
4. Bの全文削除がcomposerだけへ作用するか
5. 机上でセンサーマウス、持ち上げてStickマウスへ自動で切り替わるか
6. DISABLED中にTALKをSL/SRへ変更し、即時反映と再起動後の保存を確認できるか
7. HOMEで左サイドバーの前、Cで次のチャットへ直接移動するか
8. SRで推論レベルが上がり、SLで下がるか
9. 机上ではZRが左クリック、持ち上げ中はZRがメイン／サイド入力欄を交互に切り替えるか
10. 机上・持ち上げ中ともStick押込で左クリックできるか
11. X短押しでEscape、長押しで最新メッセージまで移動するか

差分があっても、まず `controller` 側で調整し、Bridgeには必要以上に手を入れません。
