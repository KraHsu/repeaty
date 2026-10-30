//! Desktop workspace storage and isolated file protocol experiments.
#![deny(unsafe_op_in_unsafe_fn)]

pub mod atomic;
pub mod attachments;
pub mod backup;
pub mod files;
pub mod preview;
pub mod prototype;

pub mod error;
pub mod records;

pub mod library;

pub mod recovery_catalog;
pub mod sessions;
pub mod watch;

mod retirement;

mod working_media;

mod detection;
mod materials;
#[cfg(test)]
mod p4_tests;
#[cfg(test)]
mod p5_tests;
#[cfg(test)]
mod p6_tests;
#[cfg(test)]
mod p7_tests;
mod study;
