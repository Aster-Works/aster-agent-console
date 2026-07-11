# Audit-trail integrity

Aster Agent Audit hash-chains recorded events so that after-the-fact
modification is **detectable**. This page explains exactly what that gives
you — and what it does not.

## What it is

Every ingested event is stored with a SHA-256 hash computed over its content
and the hash of the previous event in the same session:

```
eventHash = SHA-256( integritySchemaVersion : previousHash : canonical(event) )
```

`canonical(event)` is a deterministic JSON serialization (keys sorted at every
depth), so the same event always produces the same hash. The first event of a
session links to the constant `genesis`.

`aster-audit verify` recomputes the chain and reports, per session:

| Verdict | Meaning |
|---|---|
| `verified` | every hashed event matches its stored hash and links correctly |
| `broken` | an event's content no longer matches its hash, an event was removed (link mismatch), or an unhashed row sits after hashed ones (gap) |
| `legacy-unverified` | the session's events predate hash chaining — they **cannot** be verified, which is different from being broken |

```bash
aster-audit verify                  # whole database; exit 1 on any break
aster-audit verify --session <id>
aster-audit verify --format json    # machine-readable
```

## What it is NOT

- **Not tamper-proofing.** Anyone who can write the SQLite file can rewrite
  events *and* recompute the whole chain. The chain detects casual or partial
  modification; it does not stop an attacker with full local access. Treat it
  as a seal, not a safe.
- **Not a signature.** The chain is unkeyed. A externally-signed evidence
  manifest is a separate, future feature and will be labeled as such.
- **Not retroactive.** Events recorded before chaining existed stay
  `legacy-unverified` forever; only new events are covered.

## What is covered by the hash

The event's **observed core**: id, session, agent, source, type, turn,
repository, working directory, the agent-side timestamp, model, tool name,
summary, and the redacted input/output.

Deliberately **excluded** (documented limitation, not an oversight):

- `title`, `links`, `metrics` — legitimately rewritten by enrichment (git and
  test association) after insert. They are derived decoration, recomputable
  from the core.
- `receivedAt` — when the collector saw the event, not when the agent acted.
  Re-importing the same Codex rollout line after a cursor loss re-stamps it,
  and an idempotent re-import must not read as tampering.
- Risk findings — they live in their own table with their own lifecycle.

Consequence: an edit that ONLY touches those fields is not detected by
`verify`. Everything the agent actually did (commands, files, outputs) is
covered.

## Re-ingesting events

Event storage is idempotent (`insert or replace` by event id). A re-ingested
event keeps its original chain position and predecessor:

- identical payload → identical hash → the chain stays intact;
- changed payload → different hash → `verify` reports a break at the next
  link. Idempotent by design, tamper-evident by consequence.

## Evidence bundle

```bash
aster-audit report --type evidence [--session <id>] [--out bundle.json]
```

One self-contained JSON document: product and schema versions, export
timestamp, filters, all events **with their chain hashes**, findings, the
effective policy (with sources), and the verification verdict computed at
export time. Events are exported exactly as stored — redacted at ingest
(best-effort, pattern-based). The bundle itself is a plain file; protecting
it after export is up to you.
