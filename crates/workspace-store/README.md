# Workspace persistence prototype

M0 experiment for [Repeaty's workspace plan](../../docs/WORKSPACE_M0.md). This crate is not connected to the client, server, or existing libraries. Tests use disposable directories and synthetic data.

```sh
cargo test --locked --manifest-path crates/workspace-store/Cargo.toml
cargo clippy --locked --manifest-path crates/workspace-store/Cargo.toml --all-targets -- -D warnings
```

The native primitives preserve the actual displaced file instead of copying a preflight version and overwriting it. They do not implement compare-and-swap, undo, filesystem traversal, or conflict resolution. A caller must retain the displaced path even after success: an editor can keep writing through an older handle. Failures never fall back to an ordinary overwrite.

| Platform | Replace existing             | Create without clobbering          | Validation                            |
| -------- | ---------------------------- | ---------------------------------- | ------------------------------------- |
| Linux    | `renameat2(RENAME_EXCHANGE)` | `RENAME_NOREPLACE`                 | Local temporary-file tests passed     |
| macOS    | `renamex_np(RENAME_SWAP)`    | `RENAME_EXCL`                      | Implemented; native execution pending |
| Windows  | `ReplaceFileW` with backup   | `MoveFileExW` without replace flag | Implemented; native execution pending |

Files are synced before publication. Unix also syncs directories; Windows reports file-only sync coverage. Process-crash tests cannot establish power-loss durability, and these experiments do not validate network filesystems, hostile directory replacement, all editors, or real libraries.

API references: [Linux rename](https://man7.org/linux/man-pages/man2/rename.2.html), [Apple rename flags and declarations](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/stdio.h), [Windows ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew).
