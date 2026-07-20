# Migrating from Aster Agent Console

The project was renamed **Aster Agent Console → Aster Agent Audit**. This page
covers what changed, what `migrate` does (and does not do), and how to get
unstuck if something looks off.

## What changed

| | Old | New |
|---|---|---|
| Product name | Aster Agent Console | Aster Agent Audit |
| CLI command | `aster-agent` | `aster-audit` |
| npm package | `@asterworks/agent-console` | `@asterworks/agent-audit` |
| Data directory | `~/.aster-agent-console/` | `~/.aster-agent-audit/` |
| Background service (launchd label) | `com.asterworks.agent-console` | `com.asterworks.agent-audit` |

`@asterworks/agent-audit` is published on npm — install it with
`npm install -g @asterworks/agent-audit`. It provides **both** the
`aster-audit` command and the legacy `aster-agent` alias, so switching
packages does not change any script or muscle memory.

## Nothing breaks automatically

Upgrading (or continuing to run an existing install) does not require you to
do anything:

- **`aster-agent` keeps working.** It's now a permanent alias for `aster-audit`
  — same binary, same behavior. Running it prints a two-line notice on
  `stderr` so you know it's there; nothing else changes, and scripts that
  parse stdout are unaffected.
- **Your data stays where it is.** If `~/.aster-agent-audit/` doesn't exist
  yet, the tool keeps reading and writing `~/.aster-agent-console/` exactly as
  before. There is **no automatic migration** — the data directory only
  changes once you run `aster-audit migrate` yourself.
- **The background service (if installed) keeps running** under its old
  launchd label until you reinstall it.

In short: doing nothing is a completely valid choice. Migrate when it's
convenient, or stay on the legacy directory indefinitely — both are supported.

## What `aster-audit migrate` does

```bash
aster-audit migrate --dry-run   # preview only, changes nothing
aster-audit migrate             # perform the migration
```

`migrate` **copies** `~/.aster-agent-console/` to `~/.aster-agent-audit/`. It
never moves or deletes anything:

- **The legacy directory is never modified**, with one exception: after a
  successful migration, a single marker file (`MIGRATED.json`) is added to it.
  No existing file inside `~/.aster-agent-console/` is touched, moved, or
  deleted. The untouched legacy directory **is** your backup — you don't need
  to make a separate copy first.
- **The database is copied consistently.** The SQLite file is copied via
  better-sqlite3's backup API (safe under WAL), not a raw file copy. `migrate`
  checks whether a collector is currently running against the legacy DB and
  **refuses to run if one is** (stop it first — see Troubleshooting below).
- **The event spool is carried over.** Any events buffered because the
  collector was offline (`spool/`) move with the rest of the data and are
  still replayed normally afterward.
- **The Codex import cursor is carried over.** `codex-import.json` (which
  rollout files have already been ingested) is copied so Codex sessions are
  not re-imported as duplicates.
- **`config.json`'s stored database path is rewritten** to point at the new
  directory.
- **Hook scripts are regenerated, not copied.** The old generated hook
  scripts have the legacy spool path baked in, so `migrate` writes fresh ones
  for the new directory instead of copying the old files verbatim.
- **Live hook entries are re-pointed.** If `~/.claude/settings.json` (and, if
  present, the managed block in `~/.codex/config.toml`) references the legacy
  directory, `migrate` rewrites those entries to the new path — **after
  taking a timestamped backup of the file first**.
- **It's idempotent.** A completed migration is detected via a marker file in
  the new directory; running `migrate` again reports "already migrated" and
  changes nothing further.
- **It's crash-safe.** The new directory is built under a temporary
  `.partial` name and only renamed into place once everything above has
  succeeded. If `migrate` is interrupted or fails partway through, the app
  keeps starting from the intact legacy data — there's no half-built
  directory it could pick up by mistake.

After migrating, reinstall the background service if you use one — the
launchd label changed, so the old job needs to be replaced:

```bash
aster-audit service install
```

## Recommended path

1. Update to the version of the CLI that includes `migrate` (via `aster-agent`
   or `aster-audit` — both work).
2. Run `aster-audit migrate --dry-run` and read the plan it prints.
3. Stop any running collector (`aster-audit service uninstall`, or close the
   dashboard).
4. Run `aster-audit migrate` for real.
5. Run `aster-audit doctor` to confirm the new directory is in use.
6. If you run the background service, reinstall it: `aster-audit service install`.

## Troubleshooting

**"A collector is running" / migrate refuses to start.**
Stop it first, then re-run:

```bash
aster-audit service uninstall   # if you run the background service
# or just close the dashboard / Ctrl+C the terminal running `aster-audit serve`
```

**I ran `migrate` and now I want to go back to the legacy directory.**
Nothing was deleted or moved — `~/.aster-agent-console/` is untouched except
for one added marker file (`MIGRATED.json`). If you need to fully revert a
hook re-point, restore `~/.claude/settings.json` (and `~/.codex/config.toml`
if applicable) from the timestamped backup `migrate` wrote before editing them
— check `~/.aster-agent-audit/backups/` for the `.bak` files.

**`migrate` says "conflict" — a new directory already exists with no marker.**
This means `~/.aster-agent-audit/` exists but wasn't created by `migrate`
(e.g. a fresh install already wrote to it). `migrate` refuses to overwrite it.
If it holds nothing you need, remove it and re-run; if it holds real data,
decide which directory is current and remove the other one manually.

**I just want to keep using the legacy directory.**
That's fine — there is no forced cutover. As long as
`~/.aster-agent-console/` exists and `~/.aster-agent-audit/` doesn't, the tool
keeps using the legacy directory automatically.

**Is my data safe during migration?**
Yes — `migrate` only ever *adds* to `~/.aster-agent-console/` (one marker
file) and *builds* `~/.aster-agent-audit/` in a temporary staging location
that's renamed into place atomically only once the copy is complete. A failed
or interrupted run leaves the legacy directory as the active one, exactly as
before you ran the command.

## FAQ

**Do I have to migrate?**
No. `aster-agent` keeps working, and the tool keeps using
`~/.aster-agent-console/` automatically for as long as that's the only data
directory that exists.

**Will `npm install -g @asterworks/agent-console` still work after the
rename?**
Yes — the legacy package stays installable (it is never unpublished), but it
no longer receives updates. New installs should use
`npm install -g @asterworks/agent-audit`, which also provides the
`aster-agent` alias.

**Does migrating delete my old data?**
No. `migrate` copies data; it never deletes or moves the legacy directory.

**What if I run both `aster-agent` and `aster-audit` on the same machine?**
They're the same binary — there's nothing to keep in sync. Whichever command
name you type, it reads and writes the same data directory (legacy or new,
per the rules above).
