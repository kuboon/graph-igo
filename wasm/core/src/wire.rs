//! The JSON both modules speak. Field names are camelCase on the wire.
//!
//! Colours are numbers: `0` empty, `1` black, `2` white. A node is its index; `null` where a node
//! is expected means a pass.

use serde::{Deserialize, Serialize};

use crate::Color;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GraphSpec {
    pub node_count: usize,
    pub edges: Vec<[usize; 2]>,
}

/// A board's position: the graph, the colour of every node, and the ko ban if there is one.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub graph: GraphSpec,
    pub stones: Vec<Color>,
    #[serde(default)]
    pub ko: Option<usize>,
}

/// An empty region with its boundary stones, cut out of the board — what a judge is handed.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Subgraph {
    pub node_count: usize,
    pub edges: Vec<[usize; 2]>,
    pub stones: Vec<Color>,
    /// The board node each local node came from.
    pub origin: Vec<usize>,
}

// --- engine -------------------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    #[serde(flatten)]
    pub position: Position,
    pub color: Color,
    /// `null` passes.
    pub node: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlayResponse {
    pub legal: bool,
    /// Why the move was refused: `occupied`, `ko`, `suicide`, `outOfRange` or `invalidColor`.
    pub reason: Option<&'static str>,
    /// The position after the move — unchanged when the move was refused.
    pub stones: Vec<Color>,
    pub ko: Option<usize>,
    pub captured: Vec<usize>,
    /// The placed stone's group, and that group's liberties.
    pub group: Vec<usize>,
    pub liberties: usize,
    /// Opponent stones left in atari by the move.
    pub atari: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionsRequest {
    pub graph: GraphSpec,
    pub stones: Vec<Color>,
    #[serde(default = "one")]
    pub min_size: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionOut {
    pub nodes: Vec<usize>,
    pub boundary: Vec<usize>,
    pub subgraph: Subgraph,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RegionsResponse {
    pub regions: Vec<RegionOut>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateRequest {
    pub graph: GraphSpec,
    pub stones: Vec<Color>,
    /// Regions this size or larger go to the CPU; smaller ones the engine settles itself.
    #[serde(default = "one")]
    pub min_size: usize,
    #[serde(default)]
    pub komi: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Tally {
    pub stones: usize,
    pub territory: usize,
    pub score: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JudgedRegion {
    pub nodes: Vec<usize>,
    pub owner: Color,
    pub confidence: f64,
    /// `cpu` when the CPU module decided it, `engine` for a region under `minSize`.
    pub judged_by: &'static str,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateResponse {
    pub black: Tally,
    pub white: Tally,
    pub komi: f64,
    /// `1` black, `2` white, `0` a draw.
    pub winner: Color,
    pub regions: Vec<JudgedRegion>,
}

// --- cpu ----------------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JudgeResponse {
    /// Whose territory the region is: `1` black, `2` white, `0` neither.
    pub owner: Color,
    /// How sure the judge is, from 0 to 1.
    pub confidence: f64,
    /// The judge's call for every node of the subgraph, stones included.
    pub node_owners: Vec<Color>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenmoveRequest {
    #[serde(flatten)]
    pub position: Position,
    pub color: Color,
    #[serde(default)]
    pub komi: f64,
    /// Random games to play out in total, spread over the candidate moves.
    #[serde(default = "default_playouts")]
    pub playouts: u32,
    #[serde(default)]
    pub seed: u32,
    /// The opponent's last move was a pass: passing back ends the game.
    #[serde(default)]
    pub opponent_passed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub node: usize,
    pub win_rate: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenmoveResponse {
    /// `null` passes.
    pub node: Option<usize>,
    pub win_rate: f64,
    /// The best few moves considered, best first.
    pub candidates: Vec<Candidate>,
}

fn one() -> usize {
    1
}

fn default_playouts() -> u32 {
    2000
}
