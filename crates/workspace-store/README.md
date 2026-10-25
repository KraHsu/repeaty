# Workspace persistence prototype

M0 experiment for [Repeaty's workspace plan](../../docs/WORKSPACE_M0.md). This crate is not connected to the client, server, or existing libraries. Tests use disposable directories and synthetic data.

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

Tests cover 9 interruption boundaries for both edits and draft confirmation by exiting child processes without destructors. They also cover late editor writes, target collisions, missing or corrupt evidence, draft reservations, SQLite constraint rollback and unchanged scheduling. The scope is one Markdown file, its content object and SQLite state; attachment bundles, real Markdown/domain acceptance, arbitrary paths, editor integration and durable conflict resolution remain outside this experiment.
