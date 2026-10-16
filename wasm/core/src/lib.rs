//! Go on an arbitrary graph.
//!
//! The board is a simple undirected graph: a node is a point, an edge is an adjacency. Everything
//! else is ordinary Go — a group is a connected set of same-coloured stones, its liberties are the
//! empty nodes adjacent to it, and a group without liberties is captured.
//!
//! This crate is the shared rulebook. The engine module (`graph-go-engine`) exposes it to the
//! page, and the CPU module (`graph-go-cpu`) links it in so it can play legal moves on its own.

pub mod abi;
pub mod board;
pub mod graph;
pub mod region;
pub mod wire;

pub use board::{Board, Illegal, PlayOutcome};
pub use graph::Graph;
pub use region::{empty_regions, Region};

/// The state of one node. Kept as a plain `u8` because it crosses the wasm boundary as a number.
pub type Color = u8;

pub const EMPTY: Color = 0;
pub const BLACK: Color = 1;
pub const WHITE: Color = 2;

/// The other player. Only meaningful for [`BLACK`] and [`WHITE`].
pub fn opponent(color: Color) -> Color {
    3 - color
}

pub fn is_player(color: Color) -> bool {
    color == BLACK || color == WHITE
}
