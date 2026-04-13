# そろばん塾ピコ 勤怠管理アプリ - 進捗メモ

## プロジェクト概要
そろばん塾ピコの講師がスマホから勤怠を登録するWebアプリ。

- **URL（開発）**：`npm run dev` → http://localhost:3000
- **Supabase プロジェクト**：塾アプリと同じ（ouoawypwkfcdhxqyixue）
- **メインカラー**：黄色（#F5C200）
- **キャラクター**：にわとりとひよこ（`public/pico 2026-04-12 211036.png`）

---

## 技術スタック
- Next.js 16.2.3（App Router, TypeScript）
- Tailwind CSS v4
- Supabase（DB）

---

## Supabase テーブル構成

### itoshima_teachers（塾アプリと共用）
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー |
| name | text | 講師名 |
| password | text | 初期値 = codeと同じ数字 |
| code | integer | 講師ID（ログイン用） |
| is_admin | boolean | 塾アプリの管理者フラグ |
| is_soroban_admin | boolean | そろばんアプリの管理者フラグ |
| created_at | timestamp | |

### soroban_campuses（校舎テーブル）
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー |
| name | text | 校舎名 |
| cleanup_minutes | integer | 1日あたりの業務時間（分）|
| sort_order | integer | 表示順 |
| created_at | timestamp | |

**校舎データ（登録済み）**
| 校舎名 | 業務時間/日 |
|---|---|
| 前原前校 | 15分 |
| 可也校 | 15分 |
| 南校 | 15分 |
| 春風校 | 15分 |
| 東校 | 30分 |

### soroban_attendances（勤怠テーブル）
| カラム | 型 | 備考 |
|---|---|---|
| id | uuid | 主キー |
| teacher_id | uuid | itoshima_teachers への外部キー |
| date | date | 勤務日（当日固定） |
| campus_id | uuid | soroban_campuses への外部キー |
| periods | integer | 授業コマ数（0〜3） |
| work_minutes | integer | 業務時間（campus.cleanup_minutes を自動セット） |
| extra_minutes | integer | その他業務時間（分）default 0 |
| notes | text/null | 現在は使用しない |
| created_at | timestamp | |

**重要**: RLSは無効。work_minutes は campus.cleanup_minutes をそのまま保存（コマ数×ではない）。

---

## そろばん講師一覧（12名）
| code | 名前 | パスワード初期値 |
|---|---|---|
| 4004 | 結城加奈子 | 4004 |
| 4005 | 吉田裕子 | 4005 |
| 4007 | 行弘ふじ子 | 4007 |
| 4008 | 山﨑邦弘 | 4008 |
| 4009 | 坂田龍博 | 4009 |
| 4011 | 山方ゆかり | 4011 |
| 4013 | 牧山香穂 | 4013 |
| 4016 | 藤本万里子 | 4016 |
| 4026 | 山西道江 | 4026 |
| 4027 | 宮﨑優 | 4027 |
| 4029 | 平山優愛来 | 4029 |
| 4030 | 内山奈々 | 4030 |

---

## 画面構成

### 1. ログイン画面（`/`）
- 講師ID（数字）＋パスワードで認証
- セッションは localStorage に保存（`soroban_teacher` キー：`{id, name, is_soroban_admin}`）
- ログイン済みなら `/attendance`（管理者なら `/admin`）にリダイレクト
- キャラクター画像をPC左右・スマホカード上部に表示

### 2. 勤怠入力画面（`/attendance`）
- 勤務日：当日固定（変更不可）
- 校舎選択：5校舎をカラフルなボタンで表示→選択後は1つだけ残り「変更する」ボタン
  - 校舎カラー：前原前校=青、可也校=緑、南校=紫、春風校=ピンク、東校=シアン
  - 選択後に「事業準備のため、業務時間が自動で○分追加されます」と表示
- コマ数選択：授業なし・1コマ・2コマ・3コマ（2×2ボタン）
- その他業務時間：−10分/＋10分のステッパー（会議など）
- 確認画面：校舎名を大きなカードで最上部に表示→コマ数→業務時間（注記付き）
- 送信後：完了画面

### 3. 勤怠履歴画面（`/history`）
- 月選択フィルター
- 月間合計（コマ数・業務時間・その他時間）
- 日別レコード一覧

### 4. 管理者画面（`/admin`）
- 管理者のみアクセス可（is_soroban_admin = true）
- 月選択→講師別サマリー（コマ・業務時間・その他）
- 各レコードの編集・削除

---

## ファイル構成
```
soroban-attendance/
  app/
    layout.tsx       # タイトル・メタデータ
    globals.css      # Tailwind v4、ダークモードなし
    page.tsx         # ログイン画面
    attendance/
      page.tsx       # 勤怠入力画面
    history/
      page.tsx       # 勤怠履歴画面
    admin/
      page.tsx       # 管理者画面
  lib/
    supabase.ts      # Supabaseクライアント
  types/
    index.ts         # 型定義
  public/
    pico 2026-04-12 211036.png  # キャラクター画像
  .env.local         # Supabase接続情報
  PROJECT_NOTES.md   # このファイル
```

---

## 認証方式
- Supabase Auth は使わない
- `itoshima_teachers.code`（整数）＋ `password` でログイン
- セッションは `localStorage` の `soroban_teacher` で管理

---

## デザイン方針
- スマホファースト
- メインカラー：#F5C200（黄色）
- 年配講師向けに文字・ボタン大きめ
- 校舎ボタン：白背景＋色枠（未選択）→ベタ塗り（選択済み）
- 選択後は選んだ校舎だけ表示して他を隠す

---

## 管理者アカウントの設定方法
管理者にしたい講師の `is_soroban_admin` を true にする：
```sql
UPDATE itoshima_teachers SET is_soroban_admin = true WHERE code = ????;
```

---

## 次にやること（TODO）
- [ ] 管理者アカウントの設定（誰を管理者にするか確認）
- [ ] 実機（スマホ）での動作確認
- [ ] 本番デプロイ（Vercelなど）
