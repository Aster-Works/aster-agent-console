/**
 * The single source of truth for every product name, path, and label.
 *
 * The product was renamed "Aster Agent Console" → "Aster Agent Audit".
 * Everything that ships — CLI names, the data directory, the launchd label,
 * the config-file fence markers — exists in a NEW and a LEGACY form, and the
 * legacy forms are recognized FOREVER: `hooks uninstall` must be able to
 * restore a config written by any prior version, and `service uninstall`
 * must find a job installed under the old label.
 *
 * Tests deliberately assert these values as string literals rather than
 * importing them, so a rename cannot silently desync source and tests.
 */

export const PRODUCT_NAME = "Aster Agent Audit";
export const LEGACY_PRODUCT_NAME = "Aster Agent Console";

export const CLI_NAME = "aster-audit";
/** Kept as an alias during the migration period — same binary, same behavior. */
export const LEGACY_CLI_NAME = "aster-agent";

export const NPM_PACKAGE = "@asterworks/agent-audit";
export const LEGACY_NPM_PACKAGE = "@asterworks/agent-console";

export const DATA_DIR_NAME = ".aster-agent-audit";
export const LEGACY_DATA_DIR_NAME = ".aster-agent-console";

/**
 * The SQLite file keeps its historical name even inside the new directory:
 * migration copies it byte-for-byte (via the SQLite backup API), and nothing
 * is gained by renaming the file itself — config.json's dbPath would need
 * rewriting either way, and a stable name keeps the copy verifiable.
 */
export const DB_FILE_NAME = "agent-console.db";

export const LAUNCHD_LABEL = "com.asterworks.agent-audit";
export const LEGACY_LAUNCHD_LABEL = "com.asterworks.agent-console";

/** Fence markers for the managed block in ~/.codex/config.toml. */
export const FENCE_MARKER = "aster-agent-audit";
export const FENCE_START = "# >>> aster-agent-audit (managed) >>>";
export const FENCE_END = "# <<< aster-agent-audit (managed) <<<";
export const LEGACY_FENCE_MARKER = "aster-agent-console";
export const LEGACY_FENCE_START = "# >>> aster-agent-console (managed) >>>";
export const LEGACY_FENCE_END = "# <<< aster-agent-console (managed) <<<";

/** Written into the NEW data dir by `migrate`; its presence = migration done. */
export const MIGRATION_MARKER_FILE = "migration.json";
/** Written into the OLD data dir so a stray legacy binary knows to look forward. */
export const LEGACY_FORWARD_MARKER_FILE = "MIGRATED.json";

/** Current GitHub home. Update via MIGRATION_AND_RELEASE.md when the repo is renamed. */
export const REPO_URL = "https://github.com/Aster-Works/aster-agent-console";
