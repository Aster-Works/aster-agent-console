# Migration & Release Checklist (maintainers)

This is the manual, human-triggered runbook for finishing the
**Aster Agent Console → Aster Agent Audit** rename in the outside world (repo,
npm, announcements). Code, tests, and docs for the rename are already done;
everything below is irreversible or account-gated, so nothing here runs
automatically. Work top to bottom — later steps assume earlier ones are done.

See also: `docs/migration-from-agent-console.md` (user-facing migration guide)
and `docs/release.md` (now a stub pointing here).

---

## 1. GitHub repository rename

- [ ] Rename the repo on GitHub: `Aster-Works/aster-agent-console` →
      `Aster-Works/aster-agent-audit` (Settings → repository name).
- [ ] Confirm GitHub's automatic redirect works: the old URL
      `github.com/Aster-Works/aster-agent-console` should redirect to the new
      one for web traffic, `git clone`, and `git remote` pulls/pushes.
      Verify with a fresh clone:
      ```bash
      git clone https://github.com/Aster-Works/aster-agent-console.git /tmp/rename-check
      cd /tmp/rename-check && git remote -v   # should resolve, possibly via redirect
      ```
- [ ] Update any local remotes on maintainer machines
      (`git remote set-url origin https://github.com/Aster-Works/aster-agent-audit.git`) —
      not required (the redirect covers it) but avoids relying on the redirect
      long-term.
- [ ] Update repo settings that reference the old name directly: About/description
      text, topics, social preview image, GitHub Pages config (if any).
- [ ] Update the **security advisory** and **issues** links referenced from
      README/CONTRIBUTING once the new URL is confirmed working (see §4).

---

## 2. `package.json` URL fields

`src/core/branding.ts`'s `REPO_URL` constant currently still points at
`https://github.com/Aster-Works/aster-agent-console` on purpose — it's wired
to update here, once the rename is real, not before.

- [ ] After §1 is confirmed working, update in `package.json`:
      - `repository.url` → `git+https://github.com/Aster-Works/aster-agent-audit.git`
      - `homepage` → `https://github.com/Aster-Works/aster-agent-audit#readme`
      - `bugs.url` → `https://github.com/Aster-Works/aster-agent-audit/issues`
- [ ] Update `REPO_URL` in `src/core/branding.ts` to match.
- [ ] Grep for any other hardcoded `Aster-Works/aster-agent-console` URLs in
      `README.md`, `docs/`, and source, and update them:
      ```bash
      grep -rn "Aster-Works/aster-agent-console" README.md docs/ src/
      ```
- [ ] Commit this as its own change (`chore: point repo URLs at renamed repo`)
      so it's easy to review and revert independently of feature work.

**Timing:** do this only after the GitHub rename (§1) is live, so the URLs in
a freshly published package are never briefly wrong.

---

## 3. npm: publish the new package

- [ ] Bump `version` in `package.json` if not already done for this release.
- [ ] Pre-flight (all green before publishing):
      ```bash
      pnpm test            # vitest — 133 tests must pass
      pnpm typecheck:all
      pnpm build:all
      npm publish --dry-run
      ```
      Confirm the dry-run tarball contains `dist/web`, `dist-cli/`, `README.md`,
      `CHANGELOG.md`, `LICENSE`, `package.json` — no source, no `.db`, no
      secrets.
- [ ] Publish the new package:
      ```bash
      npm publish --access public
      ```
      `bin` already maps **both** `aster-audit` and `aster-agent` to
      `dist-cli/index.js` (see `package.json`), so installing
      `@asterworks/agent-audit` gives users both commands immediately.
- [ ] Confirm on npm: `npm view @asterworks/agent-audit` shows the expected
      version and `bin` entries.

---

## 4. npm: deprecate the old package

Only after §3 is confirmed live and installable.

- [ ] Deprecate `@asterworks/agent-console` with a message pointing at the new
      package name (do **not** unpublish — that breaks anyone pinned to it):
      ```bash
      npm deprecate @asterworks/agent-console "Renamed to @asterworks/agent-audit — npm install -g @asterworks/agent-audit. See https://github.com/Aster-Works/aster-agent-audit/blob/main/docs/migration-from-agent-console.md"
      ```
- [ ] Verify the deprecation notice shows up on an install:
      ```bash
      npm install -g @asterworks/agent-console   # should print the deprecation warning
      ```

---

## 5. Update `package.json` URLs and README for real (post-publish)

- [ ] Confirm §2's URL changes shipped in the published package
      (`npm view @asterworks/agent-audit repository.url`).
- [ ] Update the README's "Not published yet" callouts (English and Japanese)
      now that `@asterworks/agent-audit` is live:
      - Remove the "Not published yet" / "まだ未公開です" notes.
      - Change the install snippet's comment if it referenced the legacy
        package as current.
- [ ] Update `docs/migration-from-agent-console.md`'s FAQ answer about
      publish status.

---

## 6. Release tag & announcement

- [ ] Tag the release:
      ```bash
      git tag v$(node -p "require('./package.json').version")
      git push --tags
      ```
- [ ] Create the GitHub release with `CHANGELOG.md` notes for this version:
      ```bash
      gh release create v$(node -p "require('./package.json').version") --notes-file CHANGELOG.md
      ```
- [ ] Post an announcement (issue, discussion, or release notes) using this
      template:

      ```markdown
      ## Aster Agent Console is now Aster Agent Audit

      This project has been renamed to better reflect what it does: a
      local-first audit and security observability layer for AI coding
      agents (Claude Code + Codex).

      **What changed:** product name, CLI (`aster-agent` → `aster-audit`),
      npm package (`@asterworks/agent-console` → `@asterworks/agent-audit`),
      data directory (`~/.aster-agent-console` → `~/.aster-agent-audit`).

      **What didn't change:** your data, your workflow, or the `aster-agent`
      command — it keeps working as an alias.

      **Nothing breaks and nothing migrates automatically.** Read the full
      guide: [Migrating from Aster Agent Console](docs/migration-from-agent-console.md).
      ```
- [ ] Pin or link the announcement from the repo's issue #1 (Pro/Team interest
      thread) if still active, so existing watchers see it.

---

## Reminders

- Steps 1, 3, 4, and 6 are **irreversible or hard to undo** (GitHub rename
  redirects can be relied on but not un-renamed cleanly; npm publishes are
  immutable; `npm deprecate` is visible to every future installer). Do them in
  order, and don't skip the dry-runs.
- Don't unpublish `@asterworks/agent-console` — deprecate only. Users on old
  lockfiles/CI pins need it to keep resolving.
- Don't overclaim in the announcement: this is a rename, not a new product —
  keep the "beta" framing and avoid words like "enterprise-grade,"
  "compliant," or "tamper-proof."
