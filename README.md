# Aster Agent Audit

> **A local-first audit and security observability layer for AI coding agents.**

See what Claude Code and Codex did, detect risky behavior, inspect MCP exposure, and produce explainable evidence—without sending your code or prompts to a cloud service.

![Aster Agent Audit — product tour](docs/assets/demo-tour.gif)

Aster Agent Audit makes the work of AI coding agents visible along three axes:

1. **Safety** — dangerous shell commands, secret exposure, **MCP-server permission & vulnerability scan**, network/file/git operations.
2. **Work Audit** — an explainable timeline from user prompt → tool call → file diff → tests → commit.
3. **Outcome** — sessions, files changed, tests, commits, PR readiness, and cost per useful work.

**Why this one?** Cost CLIs (e.g. `ccusage`) only track spend; cloud agent-security scanners increasingly require an account and send data off-box. Aster Agent Audit is the one tool that puts **real safety detection + an explainable work-audit timeline + a real MCP security scan** in a single **local, no-account** dashboard — and it covers **both Claude Code and Codex** (Codex via its session/rollout logs, which most tools skip). Your code and prompts never leave your machine.

## Install

Requires Node.js ≥ 20.

```bash
npm install -g @asterworks/agent-audit   # then use the `aster-audit` command
# or run without installing:
npx @asterworks/agent-audit dashboard
```

> **Not published yet.** `@asterworks/agent-audit` hasn't been published to npm. Until it is, `@asterworks/agent-console` (`aster-agent` command) is the latest published package — see [Migrating from Aster Agent Console](docs/migration-from-agent-console.md) below.

New here? The **[5-minute quickstart](docs/quickstart.md)** takes you from install to real data.

## Migrating from Aster Agent Console

The project was renamed **Aster Agent Console → Aster Agent Audit**. If you already have Aster Agent Console installed, nothing breaks:

- The old `aster-agent` command keeps working as an alias for `aster-audit` — same binary, same behavior, just a two-line heads-up on stderr.
- Your existing data stays in `~/.aster-agent-console/` and keeps being used as-is until you migrate. Nothing moves automatically.
- When ready, run `aster-audit migrate` (add `--dry-run` first to preview) to copy your data to `~/.aster-agent-audit/`. It's a copy, not a move — `~/.aster-agent-console/` is left completely untouched and doubles as your backup. Migration also carries the unread event spool and the Codex import cursor, rewrites `config.json`'s stored path, regenerates hook scripts, and re-points the hook entries in `~/.claude/settings.json` (backing that file up first). It refuses to run while a collector is active, and re-running it is a no-op once done.
- The background service's launchd label also changed (`com.asterworks.agent-audit`); after migrating, reinstall it with `aster-audit service install` so it picks up the new data directory.

Full walkthrough, troubleshooting, and FAQ: **[docs/migration-from-agent-console.md](docs/migration-from-agent-console.md)**.

## Trust by default

> **No account. No cloud. Your agent history stays on your machine.**

- No external upload by default. Cloud sync stays opt-in, always.
- Secrets are **redacted before storage** — known secret patterns are stripped
  before anything is written to disk (best-effort, pattern-based defense in
  depth; see [privacy](docs/privacy.md)).
- Hook config changes are always backed up first, and fully reversible.
- The local server binds to `127.0.0.1` only and never executes what it collects.

## Status

| Phase | Scope | State |
|------|-------|-------|
| 1 | Local dashboard MVP (Vite + React, deterministic demo data) | ✅ Done |
| 2 | Local collector + SQLite (`POST /events`, redaction, risk, SSE) | ✅ Done |
| 3 | CLI (`aster-audit dashboard / doctor / init`) | ✅ Done |
| 4 | Claude Code + Codex hook integration (install + spool) | ✅ Done |
| 5 | Git & test enrichment (real file diffs, commit association, test results) | ✅ Done |
| 6 | AsterGuard integration — MCP config scan, `AAC-MCP-*` rules, policy config, posture grade | ✅ Done |
| 7 | Public beta — docs, license, feedback templates, npm publish | ✅ Done |
| 8 | Codex rollout-log ingestion, Insights (latency/failures/file-types/trend/outcomes), configurable Settings, actionable Risk Radar, Japanese UI | ✅ Done |
| 9 | Activity Log — searchable when/where/what across every recorded action | ✅ Done |

141 unit/integration tests pass (`pnpm test`); web + CLI typecheck clean. Security
code has been hardened by adversarial multi-agent reviews — e.g. one caught and
fixed a real secret-redaction bug (case-sensitive key matching that missed
lowercase keys) before release.

## Documentation

- **[Quickstart](docs/quickstart.md)** — install to real data in 5 minutes.
- **[Privacy & data handling](docs/privacy.md)** — what's stored, where, redaction, how to delete it.
- **[Audit-trail integrity](docs/audit-integrity.md)** — what the hash chain detects, what it cannot, and the evidence bundle.
- **[MCP security scan](docs/mcp-security.md)** — the `AAC-MCP-*` rules, posture grade, and `policy.json`.
- **[Known limitations](docs/limitations.md)** — what this beta does and does not do.
- **[Troubleshooting](docs/troubleshooting.md)** — common issues and fixes.
- **[Contributing](CONTRIBUTING.md)** · **[Changelog](CHANGELOG.md)**

## CLI

```bash
aster-audit dashboard            # open the dashboard (reuses a running collector, or starts one)
aster-audit init                 # detect Claude Code / Codex (no agent files touched)
aster-audit init --dry-run       # detect only — modifies nothing
aster-audit init --install-hooks # install collector hooks (backs up existing config first)
aster-audit scan [dir]           # scan local MCP config for security risks (read-only)
aster-audit doctor               # check Node, storage, collector health, hooks, MCP posture
aster-audit verify               # verify the event hash chain (tamper-evidence; read-only)
aster-audit report --type evidence  # export a machine-readable evidence bundle (events + hashes + findings)
aster-audit policy validate      # validate policy.json (user + repo-local); CI exit codes
aster-audit policy test          # show the effective policy: sources, suppressed rules, overrides
aster-audit migrate [--dry-run]  # copy data from ~/.aster-agent-console to ~/.aster-agent-audit
aster-audit service install      # run the collector in the background (macOS launchd; starts at login)
aster-audit service status       # show background collector status
aster-audit service uninstall    # stop and remove the background collector
aster-audit hooks status         # show whether hooks are installed
aster-audit hooks uninstall      # back up, then remove only what was installed (restores prior config)
```

`aster-agent` still works as an alias for every command above during the migration period (same binary, same behavior).

### Background collection & retention

By default the collector only runs while `aster-audit dashboard` is open (events
are spooled and replayed otherwise). To collect **continuously** — even when no
dashboard is open — install the background service:

```bash
aster-audit service install   # always-on collector (macOS); dashboard then just views it
```

It runs `aster-audit serve` (a headless collector) via launchd, starting at
login and restarting on crash. On non-macOS, run `aster-audit serve` under your
own supervisor (systemd, pm2, …). The console keeps **30 days** of history and
prunes older data automatically, so the local database stays bounded.

### MCP security scan

`aster-audit scan` discovers your MCP config files (Claude `~/.claude.json` &
`.mcp.json`, Cursor, VS Code, Windsurf, Cline, Gemini — **and Codex's
`~/.codex/config.toml`**, parsed with a real TOML parser) and inspects them
read-only — nothing is executed. The
`AAC-MCP-*` rules mirror [AsterGuard](https://github.com/Aster-Works/aster-guard)'s
`AG-*` detections (arbitrary exec, pipe-to-shell installs, runtime env injection,
hardcoded secrets, unverified remote origins, package typosquatting, sensitive-file
access, privilege escalation, credential exfiltration) and share its A–F posture
grade. The findings feed the Risk Radar's MCP panel when the dashboard is live.

Trust without fearmongering is a policy (`~/.aster-agent-audit/policy.json`):

```json
{
  "allowedMcpHosts": ["*.mycompany.dev"],
  "ignoreRules": ["AAC-MCP-005"],
  "failOn": "high"
}
```

`allowedMcpHosts` silences the remote-origin finding for hosts you've vetted
(`*.domain` matches subdomains and the apex), `ignoreRules` suppresses rule ids
everywhere, and `failOn` sets the severity at which `scan` exits non-zero (for CI
/ pre-flight gating; `"never"` disables it). See [docs/mcp-security.md](docs/mcp-security.md)
for the full rule table.

The collector binds to `127.0.0.1:48321` only. Hooks read the agent event from
stdin and POST `{ agent, payload }` to the collector, which **redacts secrets
before anything is stored**. If the collector is offline, a **redacted, minimal**
event is spooled to `~/.aster-agent-audit/spool/` and replayed on the next
`aster-audit dashboard`. Hooks never execute commands and never block the agent
(short timeout, always exit 0).

## Screens

- **Overview** — KPI strip, Claude Code vs Codex comparison, risk radar, cost, live activity, repo heatmap.
- **Activity Log** — every recorded action as one searchable audit table: **when**, which agent, **where** (repo + file), **what** (the actual command, never `Bash complete`), and how it ended. Search reaches into command text, file names, tools and repos.
- **Session Replay** — multi-track timeline (User / Agent / Shell / Files / Tests / Git) with a scrubbable playhead and an event inspector (input, redacted output, diff, risk).
- **Repo Activity** — directory treemap, hot files, git timeline, contribution heatmap, file inspector.
- **Risk Radar** — severity counters, risk surface radar, category × severity matrix, finding details, MCP permission map, policy timeline.
- **Insights** — token composition & cache-hit rate, cost efficiency ($/commit, $/file), tool-usage distribution, risk-interception rate, and cost by model.
- **Agents** / **Settings** — per-agent comparison; integrations, storage, redaction & risk policy, diagnostics.

|  |  |
|---|---|
| ![Overview](docs/assets/overview.png) | ![Risk Radar](docs/assets/risk-radar.png) |
| **Overview** | **Risk Radar** |
| ![Session Replay](docs/assets/session-replay.png) | ![Repo Activity](docs/assets/repo-activity.png) |
| **Session Replay** | **Repo Activity** |
| ![Agents](docs/assets/agents.png) | ![Settings](docs/assets/settings.png) |
| **Agents** | **Settings** |

<sub>Screens shown with built-in demo data.</sub>

## Develop

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
pnpm test         # 141 unit/integration tests
pnpm typecheck:all
pnpm build:all    # dist/web (dashboard) + dist-cli (CLI bundle)
```

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup notes (including the
`corepack` signature-key workaround) and house rules. The dashboard ships with
**deterministic demo data** so every screen works before any hooks are installed
— including a redacted secret finding (`sk-ant-••••`) and dangerous-command
warnings, none of which are ever executed.

## Architecture

```
src/
  core/      shared types (event schema), redaction, risk, normalization, MCP scan + policy
  web/       Vite + React dashboard (app shell, components, routes, demo data)
  db/        SQLite (better-sqlite3) — Phase 2
  server/    local collector + dashboard API + SSE + MCP scan — Phase 2 / 6
  cli/       aster-audit CLI + hook scripts — Phase 3 / 4
```

Local data lives under `~/.aster-agent-audit/` (config, `agent-console.db`, `hooks/`, `backups/`, `spool/`, optional `policy.json`). Existing installs keep using `~/.aster-agent-console/` until you run `aster-audit migrate` — see [Migrating from Aster Agent Console](docs/migration-from-agent-console.md).

## Sponsor & Pro

Aster Agent Audit is free and open source, and stays that way for individual
local use. If it saves you time, you can **[sponsor development](https://github.com/sponsors/jimiaki7)** —
it directly funds new detection rules and broader agent coverage.

**An optional Pro / Team tier is being explored** — multi-developer aggregation,
policy-as-code distribution, compliance/audit report export (PDF/CSV), longer
retention, and dashboard SSO, most likely as a **one-time license** (local-first,
no mandatory cloud). **Would you use it?** 👍 and comment on the
**[Pro/Team interest thread (#1)](https://github.com/Aster-Works/aster-agent-console/issues/1)** —
that demand decides what gets built.

## Feedback

This is a beta — bug reports and feature ideas are welcome via
[GitHub issues](https://github.com/Aster-Works/aster-agent-console/issues).
Please report security issues privately through a
[security advisory](https://github.com/Aster-Works/aster-agent-console/security/advisories/new)
rather than a public issue.

## License

MIT © Aster Works — see [LICENSE](LICENSE).

---

# 日本語ガイド

**Aster Agent Audit** は、Claude Code や Codex が「いつ・どこで・何をしたか」を記録し、危険な操作や MCP 設定を検出して、説明可能な監査証跡として残す、**ローカルファースト**のツールです（対応エージェントは **Claude Code と Codex のみ**）。

コスト集計だけのCLI（`ccusage` 等）や、アカウント必須・データを外に送るクラウド型のエージェントセキュリティとは違い、**実際の危険検知＋説明可能な作業タイムライン＋実MCPセキュリティ診断**を、**あなたのマシン内で完結**して提供します。とくに **Codex のセッション/rolloutログ取り込み**は、多くのツールが対応していない領域です。コードもプロンプトも、マシンの外には出ません。

> **アカウント不要・クラウド不要。エージェントの履歴はあなたのマシンに残ります。**

## これは何？

エージェントの働きを3つの軸で可視化します。

1. **安全性（Safety）** — 危険なシェルコマンド、秘密情報の露出、MCP の権限リスク、ネットワーク/ファイル/git 操作。
2. **作業監査（Work Audit）** — 「プロンプト → ツール呼び出し → 差分 → テスト → コミット」という説明可能なタイムライン。
3. **成果（Outcome）** — セッション、変更ファイル、テスト、コミット、PR 準備度、そして「有益な作業あたりのコスト」。

## インストール

Node.js 20 以上が必要です。

```bash
npm install -g @asterworks/agent-audit   # 以後 `aster-audit` コマンドが使えます
# インストールせずに試す:
npx @asterworks/agent-audit dashboard
```

> **まだ未公開です。** `@asterworks/agent-audit` は npm に未公開です。公開されるまでは、旧パッケージ `@asterworks/agent-console`（`aster-agent` コマンド）が最新版です。旧バージョンからの移行は下記「[Aster Agent Console からの移行](#aster-agent-console-からの移行)」を参照してください。

導入から実データ表示まではおよそ5分です（英語の [Quickstart](docs/quickstart.md) を参照）。

## 使い方

```bash
aster-audit init        # Claude Code / Codex の連携をセットアップ（既存設定は自動バックアップ）
aster-audit dashboard   # コレクタを起動し、ブラウザでダッシュボードを開く
aster-audit doctor      # 環境チェック
aster-audit scan        # MCP 設定のセキュリティ診断
```

- **Claude Code** はローカルフックで連携します。
- **Codex** は設定を一切変更せず、セッションログ（`~/.codex/sessions`）を自動で読み取ります。他の `notify`（Codex Computer Use など）を壊しません。
- 旧コマンド `aster-agent` は移行期間中も同じ挙動のまま alias として動作します（stderr に案内が出るだけです）。

## Aster Agent Console からの移行

製品名が **Aster Agent Console → Aster Agent Audit** に変わりました。既存インストールが壊れることはありません。

- `aster-agent` コマンドは `aster-audit` の alias として動き続けます（挙動は同一）。
- 既存データは `~/.aster-agent-console/` に残ったまま使われ続けます。自動移行はしません。
- 準備ができたら `aster-audit migrate`（まずは `--dry-run` で内容確認）を実行すると、`~/.aster-agent-audit/` へデータがコピーされます。移動ではなくコピーなので、`~/.aster-agent-console/` はそのまま残りバックアップになります。
- 常駐サービスの launchd ラベルも変わったため（`com.asterworks.agent-audit`）、移行後は `aster-audit service install` を再実行してください。

詳しい手順は英語版ガイド **[docs/migration-from-agent-console.md](docs/migration-from-agent-console.md)** を参照してください。

## 安全性・プライバシー

- 既定で外部送信は一切ありません。クラウド同期は常にオプトインです。
- **秘密情報は保存前に秘匿化**されます（既知のパターンを、ディスクへ書き込む前に除去。ベストエフォート）。
- フック設定の変更は必ずバックアップされ、完全に元へ戻せます。
- ローカルサーバーは `127.0.0.1` のみにバインドし、収集した内容を実行することはありません。

> 補足：**露出した鍵は、ローテート（再発行）が唯一の確実な対処**です。ダッシュボードは秘匿化済みの記録を表示するだけで、生の鍵はエージェントのログや元の設定に残ります。Risk Radar の各指摘に、鍵をローテートする場所へのリンクを表示します。

## 画面

概要 / 操作ログ / セッション再生 / リポジトリ活動 / リスクレーダー / エージェント / インサイト / 設定。

- **操作ログ** — AI エージェントが **いつ・どこで（リポジトリとファイル）・何を（実際のコマンド）** 実行したかを1枚の監査表で一覧。コマンド本文・ファイル名・ツール名・リポジトリ名まで検索できます。失敗した操作は終了コードとともに赤字で表示されます。
- **リスクレーダー** — 危険操作・秘密露出・MCP リスクを「安全スコア」と一緒に俯瞰。指摘は **解決（Resolve）** でマークでき、鍵ローテートへ誘導します。
- **インサイト** — トークン構成・キャッシュ率・コスト効率・ツール利用・レイテンシ・失敗率・ファイル種別・日次推移・セッション転帰。
- **設定** — 連携状況・保存先・保持日数（編集可）・料金表（編集可）・エクスポート・診断。

## 言語切替（EN / 日本語）

画面右上のトグルで **EN ↔ 日本語** を切り替えられます。選択はブラウザに保存され、次回も維持されます（初回はブラウザの言語設定に従います）。

## ドキュメント（英語）

[Quickstart](docs/quickstart.md)・[プライバシー](docs/privacy.md)・[MCP セキュリティ](docs/mcp-security.md)・[既知の制限](docs/limitations.md)・[トラブルシューティング](docs/troubleshooting.md)・[Changelog](CHANGELOG.md)。

## スポンサー & Pro

本ツールは無料・オープンソースで、個人のローカル利用は今後も無料のままです。役に立ったら **[開発をスポンサー](https://github.com/sponsors/jimiaki7)** していただけると、新しい検知ルールや対応エージェントの拡充に直接つながります。

**任意の Pro / Team 層を検討中**です（複数開発者の集約・ポリシー配布・監査/コンプラレポート出力・長期保持・SSO、おそらく**買い切りライセンス**でクラウド必須にはしません）。**使いたいと思ったら**、**[Pro/Team 需要スレッド (#1)](https://github.com/Aster-Works/aster-agent-console/issues/1)** に 👍・コメントをください。何を作るかはその需要で決めます。

## フィードバック

ベータ版です。バグ報告・要望は [GitHub issues](https://github.com/Aster-Works/aster-agent-console/issues) へ。セキュリティ上の問題は公開 issue ではなく [security advisory](https://github.com/Aster-Works/aster-agent-console/security/advisories/new) からご連絡ください。

ライセンス: MIT © Aster Works
