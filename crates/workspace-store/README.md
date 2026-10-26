# Workspace persistence prototype

M0 experiment for [Repeaty's workspace plan](../../docs/WORKSPACE_M0.md). Its save protocol is not connected to active client libraries or the server. The desktop can inspect explicit experimental roots through a separate preview. Tests use disposable directories and synthetic data.

```sh
cargo test --locked --manifest-path crates/workspace-store/Cargo.toml
cargo clippy --locked --manifest-path crates/workspace-store/Cargo.toml --all-targets -- -D warnings
```

The native primitives preserve the actual displaced file instead of copying a preflight version and overwriting it. They do not implement compare-and-swap, undo, filesystem traversal, or conflict resolution. A caller must retain the displaced path even after success: an editor can keep writing through an older handle. Failures never fall back to an ordinary overwrite.

| Platform | Replace existing             | Create without clobbering          | Validation                 |
| -------- | ---------------------------- | ---------------------------------- | -------------------------- |
| Linux    | `renameat2(RENAME_EXCHANGE)` | `RENAME_NOREPLACE`                 | Local and native CI passed |
| macOS    | `renamex_np(RENAME_SWAP)`    | `RENAME_EXCL`                      | Native CI passed           |
| Windows  | `ReplaceFileW` with backup   | `MoveFileExW` without replace flag | Native CI passed           |

Files are synced before publication. Unix also syncs directories; Windows reports file-only sync coverage. Process-crash tests cannot establish power-loss durability, and these experiments do not validate network filesystems, hostile directory replacement, all editors, or real libraries.

API references: [Linux rename](https://man7.org/linux/man-pages/man2/rename.2.html), [Apple rename flags and declarations](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h), [Windows ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).

## Transaction experiment

`prototype::Prototype` can only create an empty, explicit experiment directory or reopen one with its own marker and database ID. It does not open an ordinary workspace or upgrade an existing library. The database, manifest and journal are experimental formats.

A save persists an independent content object and operation intent, reserves draft identities, records that publication is about to start, then invokes the native primitive. One SQLite transaction accepts the note version, inserts the supplied card mappings, consumes the reserved draft and records the operation receipt. Existing scheduling JSON stays untouched.

Recovery inspects the receipt, content objects and retained paths. It never exchanges files again or restores an older working file. Ambiguous publication, corrupted evidence and concurrent edits remain pending. Retained files are never garbage-collected by this prototype, so old editor handles can keep writing without losing their destination; reopening checks those paths again. A completed receipt remains completed even when its working file is later edited or deleted.

Tests cover 9 interruption boundaries for both edits and draft confirmation by exiting child processes without destructors. They also cover late editor writes, target collisions, missing or corrupt evidence, draft reservations, SQLite constraint rollback and unchanged scheduling.

## Shared content acceptance

The TypeScript [acceptance planner](../../src/workspace/acceptance.ts) reuses the Markdown codec, variant planner and existing CardDraft schema. It supplies a versioned manifest bound to exact file bytes, a stable workspace ID, existing card identities, local asset hashes, immutable source quotes and the saved draft fingerprint. Rust rechecks the manifest, objects and current SQLite baseline before one transaction retires/restores cards, accepts the content version and consumes a draft. It never regenerates the state of existing cards.

Local image/audio uploads publish complete files without clobbering occupied names. Immutable objects can share bytes; different media identities keep separate mutable working files. Existing asset edits create another accepted content version even if the Markdown bytes are unchanged. Source quotes remain attached to their original UTF-16 snapshot. HTTP media remains an external URL reference and is reported as not snapshotted.

The opt-in cross-language suite builds the `acceptance-fixture` example and passes plans from the actual TypeScript implementation into native SQLite/file operations:

```sh
npm run test:workspace:native
```

The example is a headless fixture driver, not a network endpoint or a Tauri command. Tests include real CardDraft-shaped image/audio data, cloze retirement/restoration, independent media files, tampered inputs and 11 process-exit boundaries through a media-backed confirmation. Ordinary `npm test` stays usable without Rust.

Experiment roots now use marker version 2 and database version 1002. Earlier experiment roots are rejected, never upgraded. Product version remains 0.27.0. These experiments still do not implement the final workspace manifest/schema, application directory entry points, live MCP confirmation, arbitrary paths, editor integration or durable conflict resolution.

## Desktop preview sessions

The desktop [directory preview](../../docs/WORKSPACE_DESKTOP_PREVIEW.md) uses `preview::Sessions` to create, open, close, and remember explicit experimental roots. Native pickers grant new paths; recent paths must match their recorded workspace identity. Epochs reject stale picker results before opening, and closing revokes read tokens. A device-level identity lock also excludes simultaneous sessions on copied roots.

Directory IO is lazy and runs outside the UI thread. Scans read through held directory capabilities, reject unsupported files, and return bounded raw text and accepted projections. Incomplete enumeration never establishes deletion. This does not accept edits, execute recovery, move the current study library, or implement the final workspace format. The TypeScript inspector runs in a Worker; the Vue file list is paged separately from ordinary study operations.
