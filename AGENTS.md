# Codex Grip - Agent Instructions

## 目的

このリポジトリは、Joy-Con 2またはM5Stack製の片手コントローラーから、Mac上のCodexを安全かつ素早く操作するためのプロジェクトです。

現在は **Joy-Con 2版がUX PoC兼V0**、M5Stack版はその知見を反映する専用ハード版という位置付けです。

## 作業開始時に読むもの

1. `docs/CURRENT_STATE.md`
2. `docs/ARCHITECTURE.md`
3. `docs/JOYCON_NEXT_STEPS.md`
4. 触るアプリのREADME

## 重要な制約

- `apps/joycon2/bridge` は既にJoy-Con 2入力取得とSSE配信が動いている。**必要性が明確でない限り変更しない。**
- UI座標クリックに依存しない。キーボードショートカット、deep link、明示的なローカルAPIを優先する。
- 削除・公開・シェル実行・不可逆操作などを、Joy-Conの単一ボタン1回で即確定させない。
- Joy-Con再接続時、Controller再起動時、入力停止時は安全側に倒す。
- ボタンは「押されている状態」ではなく原則Edgeで扱う。StickはLatchを使う。
- MASTER ENABLE/DISABLEを維持する。
- 危険操作を追加する前にDRY RUNとテストを追加する。
- 依存パッケージを増やす前に、Node標準機能で足りない理由を確認する。
- V0の実機差分修正と、V1のApp Server統合を同じ変更で混ぜない。

## 共通化したい意味イベント

ハード固有の入力名を、将来以下のような意味イベントへ変換する。

```text
TALK_START
TALK_STOP
ACTION
CANCEL
NEW
FOCUS
NAV_PREV
NAV_NEXT
ATTENTION      # 将来
CONTEXT        # 将来
```

Joy-Con 2の `ZR` と、M5Stack版の将来の人差し指トリガーは、どちらも `TALK_START/TALK_STOP` を生成する。

## 現在の安全不変条件

- 起動・再接続後は、一度ニュートラル状態を確認するまで操作を受け付けない。
- `+` 長押しで明示的にARMEDにするまでCodexへ操作を送らない。
- 切断・watchdog timeoutでDISABLEDへ戻る。
- ACTIONは音声入力後のdraft状態など、適切な状態でのみ有効化する。
- Codex/ChatGPT以外がfrontmostの場合の操作を制限する。

これらを壊す変更は避ける。

## テスト

```bash
npm test
```

現時点ではJoy-Con controllerのNode標準テストを実行する。

## 作業の優先順位

1. Joy-Con V0を実機で安定させる
2. 操作UXを数日使って検証する
3. 共通化する価値が確認できた部分のみ `packages/core` / `packages/mac-bridge` へ抽出する
4. M5Stackファームへ同じ意味イベントを実装する
5. 必要になった段階でCodex App Serverへ深く統合する
