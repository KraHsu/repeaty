//! M0 persistence prototype. No Tauri command, active-library access, migration, or UI entry point.
#![deny(unsafe_op_in_unsafe_fn)]

pub mod atomic;
pub mod files;
