//! The CPU module: the player the engine and the page call on.
//!
//! Exports (JSON in, JSON out — see `graph_go_core::abi`):
//!
//! - `judge` — whose territory an empty region is. The engine hands it each region as a subgraph:
//!   the region's empty nodes plus the stones around it (see `graph_go_core::region::subgraph`).
//! - `genmove` — a move for one side, by flat Monte Carlo: every candidate gets an equal share of
//!   random games played to the end, and the one that wins most often is played.
//! - `solve` — reads out a capture problem (tsumego): can the target group be taken, and what is
//!   the move? See [`solve`].
//!
//! It links the same rulebook as the engine, so the games it plays out follow the same rules.

use std::collections::VecDeque;

mod solve;

use graph_go_core::wire::{
    Candidate, GenmoveRequest, GenmoveResponse, GraphSpec, JudgeResponse, SolveRequest,
    SolveResponse, Subgraph,
};
use graph_go_core::{empty_regions, is_player, opponent, Board, Color, Graph, BLACK, EMPTY, WHITE};

graph_go_core::export_abi!();
graph_go_core::export_json!(judge, judge_json);
graph_go_core::export_json!(genmove, genmove_json);
graph_go_core::export_json!(solve, solve_json);

pub fn solve_json(req: SolveRequest) -> Result<SolveResponse, String> {
    if !is_player(req.to_move) {
        return Err(format!("toMove {} is not 1 or 2", req.to_move));
    }
    let graph = Graph::new(&req.position.graph)?;
    let board = Board::new(&graph, req.position.stones, req.position.ko)?;
    if req.target >= board.len() {
        return Err(format!("target {} is not a node", req.target));
    }
    let defender = board.stones[req.target];
    if defender == EMPTY {
        return Ok(SolveResponse {
            attacker: EMPTY,
            attacker_wins: true,
            best: None,
            captured: true,
            visited: 0,
        });
    }
    let mut reader = solve::Reader {
        target: req.target,
        attacker: opponent(defender),
        visited: 0,
    };
    let depth = req.max_depth.min(25);
    let outcome = reader.read(&board, req.to_move, depth);
    let best = solve::showcase_move(&mut reader, &board, req.to_move, depth, &outcome);
    Ok(SolveResponse {
        attacker: reader.attacker,
        attacker_wins: outcome.attacker_wins,
        best,
        captured: false,
        visited: reader.visited,
    })
}

/// How much of a region one side has to be closer to before the region is called theirs.
const OWNER_SHARE: f64 = 0.6;

pub fn judge_json(sub: Subgraph) -> Result<JudgeResponse, String> {
    if sub.stones.len() != sub.node_count {
        return Err(format!(
            "stones has {} entries but the subgraph has {} nodes",
            sub.stones.len(),
            sub.node_count
        ));
    }
    let graph = Graph::new(&GraphSpec {
        node_count: sub.node_count,
        edges: sub.edges.clone(),
    })?;
    let to_black = distances(&graph, &sub.stones, BLACK);
    let to_white = distances(&graph, &sub.stones, WHITE);

    let mut node_owners = Vec::with_capacity(sub.node_count);
    let (mut empty, mut black, mut white) = (0usize, 0usize, 0usize);
    for v in 0..sub.node_count {
        let owner = match sub.stones[v] {
            EMPTY => {
                empty += 1;
                let owner = match to_black[v].cmp(&to_white[v]) {
                    std::cmp::Ordering::Less => BLACK,
                    std::cmp::Ordering::Greater => WHITE,
                    std::cmp::Ordering::Equal => EMPTY,
                };
                match owner {
                    BLACK => black += 1,
                    WHITE => white += 1,
                    _ => {}
                }
                owner
            }
            stone => stone,
        };
        node_owners.push(owner);
    }

    let (owner, confidence) = if empty == 0 || black + white == 0 {
        // No stones anywhere near it: nobody's yet.
        (EMPTY, 0.0)
    } else {
        let black_share = black as f64 / empty as f64;
        let white_share = white as f64 / empty as f64;
        if black_share >= OWNER_SHARE {
            (BLACK, black_share)
        } else if white_share >= OWNER_SHARE {
            (WHITE, white_share)
        } else {
            (EMPTY, 1.0 - (black_share - white_share).abs())
        }
    };
    Ok(JudgeResponse {
        owner,
        confidence,
        node_owners,
    })
}

/// Steps from every node to the nearest `color` stone, walking only through empty nodes.
fn distances(graph: &Graph, stones: &[Color], color: Color) -> Vec<usize> {
    let mut dist = vec![usize::MAX; stones.len()];
    let mut queue = VecDeque::new();
    for (v, &c) in stones.iter().enumerate() {
        if c == color {
            dist[v] = 0;
            queue.push_back(v);
        }
    }
    while let Some(v) = queue.pop_front() {
        for &u in graph.neighbors(v) {
            if stones[u] == EMPTY && dist[u] == usize::MAX {
                dist[u] = dist[v] + 1;
                queue.push_back(u);
            }
        }
    }
    dist
}

pub fn genmove_json(req: GenmoveRequest) -> Result<GenmoveResponse, String> {
    if !is_player(req.color) {
        return Err(format!("color {} is not 1 or 2", req.color));
    }
    let graph = Graph::new(&req.position.graph)?;
    let mut board = Board::new(&graph, req.position.stones, req.position.ko)?;
    let color = req.color;
    let mut rng = Rng::new(req.seed);

    // Passing back ends the game, so do it only when the count as it stands is a win.
    if req.opponent_passed && margin(&board, color, req.komi) > 0.0 {
        return Ok(GenmoveResponse {
            node: None,
            win_rate: 1.0,
            candidates: Vec::new(),
        });
    }

    let mut moves: Vec<usize> = (0..board.len())
        .filter(|&v| !board.is_eye(v, color))
        .collect();
    moves.retain(|&v| board.is_legal(color, v));
    if moves.is_empty() {
        return Ok(GenmoveResponse {
            node: None,
            win_rate: 0.0,
            candidates: Vec::new(),
        });
    }
    rng.shuffle(&mut moves);

    let per_move = (req.playouts as usize / moves.len()).max(1);
    let mut scored: Vec<Candidate> = moves
        .iter()
        .map(|&node| {
            let mut wins = 0;
            for _ in 0..per_move {
                let mut game = board.clone();
                game.play_quick(color, node).expect("candidates are legal");
                if playout(&mut game, opponent(color), req.komi, &mut rng) == color {
                    wins += 1;
                }
            }
            Candidate {
                node,
                win_rate: wins as f64 / per_move as f64,
            }
        })
        .collect();
    // Stable, so equal win rates keep the shuffled order and ties break at random.
    scored.sort_by(|a, b| b.win_rate.total_cmp(&a.win_rate));
    scored.truncate(5);
    Ok(GenmoveResponse {
        node: Some(scored[0].node),
        win_rate: scored[0].win_rate,
        candidates: scored,
    })
}

/// Plays random moves (never into one's own eye) until both sides pass; returns the winner.
fn playout(board: &mut Board, mut to_move: Color, komi: f64, rng: &mut Rng) -> Color {
    let limit = board.len() * 3 + 10;
    let mut passes = 0;
    let mut empties = Vec::with_capacity(board.len());
    for _ in 0..limit {
        if passes >= 2 {
            break;
        }
        empties.clear();
        empties.extend((0..board.len()).filter(|&v| board.stones[v] == EMPTY));
        let mut played = false;
        for k in 0..empties.len() {
            let j = k + rng.below(empties.len() - k);
            empties.swap(k, j);
            let v = empties[k];
            if !board.is_eye(v, to_move) && board.play_quick(to_move, v).is_ok() {
                played = true;
                break;
            }
        }
        if played {
            passes = 0;
        } else {
            board.play(to_move, None).expect("a pass is always legal");
            passes += 1;
        }
        to_move = opponent(to_move);
    }
    if margin(board, BLACK, komi) > 0.0 {
        BLACK
    } else {
        WHITE
    }
}

/// `color`'s lead by area: stones, plus empty regions only that colour touches; komi to white.
fn margin(board: &Board, color: Color, komi: f64) -> f64 {
    let mut black = 0.0;
    let mut white = komi;
    for &c in &board.stones {
        match c {
            BLACK => black += 1.0,
            WHITE => white += 1.0,
            _ => {}
        }
    }
    for region in empty_regions(board, 1) {
        let touches = |c| region.boundary.iter().any(|&v| board.stones[v] == c);
        let size = region.nodes.len() as f64;
        match (touches(BLACK), touches(WHITE)) {
            (true, false) => black += size,
            (false, true) => white += size,
            _ => {}
        }
    }
    if color == BLACK {
        black - white
    } else {
        white - black
    }
}

/// xorshift32: small, fast, and good enough to pick random moves.
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Rng {
        Rng(if seed == 0 { 0x9e37_79b9 } else { seed })
    }

    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }

    /// Uniform-enough in `0..n`; `n` must be non-zero.
    fn below(&mut self, n: usize) -> usize {
        ((self.next() as u64 * n as u64) >> 32) as usize
    }

    fn shuffle<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            items.swap(i, self.below(i + 1));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use graph_go_core::wire::Position;

    fn grid(w: usize, h: usize) -> GraphSpec {
        let mut edges = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let v = y * w + x;
                if x + 1 < w {
                    edges.push([v, v + 1]);
                }
                if y + 1 < h {
                    edges.push([v, v + w]);
                }
            }
        }
        GraphSpec {
            node_count: w * h,
            edges,
        }
    }

    #[test]
    fn judge_gives_a_one_coloured_border_to_that_colour() {
        // Local nodes 0, 1 empty; 2, 3 black stones.
        let res = judge_json(Subgraph {
            node_count: 4,
            edges: vec![[0, 1], [0, 2], [1, 3]],
            stones: vec![0, 0, BLACK, BLACK],
            origin: vec![0, 1, 2, 3],
        })
        .unwrap();
        assert_eq!(res.owner, BLACK);
        assert_eq!(res.confidence, 1.0);
        assert_eq!(res.node_owners, vec![BLACK; 4]);
    }

    #[test]
    fn judge_splits_a_contested_region_by_distance() {
        // B . . . . W  on a path: two nodes each side are closer, so neither side gets 60%.
        let res = judge_json(Subgraph {
            node_count: 6,
            edges: (0..5).map(|i| [i, i + 1]).collect(),
            stones: vec![BLACK, 0, 0, 0, 0, WHITE],
            origin: (0..6).collect(),
        })
        .unwrap();
        assert_eq!(res.owner, EMPTY);
        assert_eq!(
            res.node_owners,
            vec![BLACK, BLACK, BLACK, WHITE, WHITE, WHITE]
        );
    }

    #[test]
    fn genmove_captures_when_it_can() {
        // White at the centre of a 3×3 in atari; black to play takes it.
        let res = genmove_json(GenmoveRequest {
            position: Position {
                graph: grid(3, 3),
                stones: vec![0, 1, 0, 1, 2, 1, 0, 0, 0],
                ko: None,
            },
            color: BLACK,
            komi: 0.5,
            playouts: 400,
            seed: 7,
            opponent_passed: false,
        })
        .unwrap();
        assert_eq!(res.node, Some(7));
    }

    #[test]
    fn genmove_passes_back_when_ahead() {
        let res = genmove_json(GenmoveRequest {
            position: Position {
                graph: grid(3, 1),
                stones: vec![1, 0, 1],
                ko: None,
            },
            color: BLACK,
            komi: 0.5,
            playouts: 100,
            seed: 1,
            opponent_passed: true,
        })
        .unwrap();
        assert_eq!(res.node, None);
    }
}

#[cfg(test)]
mod solve_tests {
    use super::*;
    use graph_go_core::wire::Position;

    fn grid6(black: &[usize], white: &[usize]) -> (GraphSpec, Vec<Color>) {
        let mut edges = Vec::new();
        for y in 0..6 {
            for x in 0..6 {
                let v = y * 6 + x;
                if x + 1 < 6 {
                    edges.push([v, v + 1]);
                }
                if y + 1 < 6 {
                    edges.push([v, v + 6]);
                }
            }
        }
        let mut stones = vec![EMPTY; 36];
        for &b in black {
            stones[b] = BLACK;
        }
        for &w in white {
            stones[w] = WHITE;
        }
        (
            GraphSpec {
                node_count: 36,
                edges,
            },
            stones,
        )
    }

    fn solve(graph: &GraphSpec, stones: &[Color], to_move: Color, target: usize) -> SolveResponse {
        solve_json(SolveRequest {
            position: Position {
                graph: graph.clone(),
                stones: stones.to_vec(),
                ko: None,
            },
            to_move,
            target,
            max_depth: 9,
        })
        .unwrap()
    }

    #[test]
    fn reads_out_an_edge_capture() {
        // The white stone on the right edge at row 1 has two liberties; blocking from the inside
        // leaves it nowhere to run.
        let (graph, stones) = grid6(&[5, 16, 23], &[9, 11]);
        let black = solve(&graph, &stones, BLACK, 11);
        assert!(black.attacker_wins);
        assert_eq!(black.attacker, BLACK);
        assert_eq!(black.best, Some(10));
        assert!(!solve(&graph, &stones, WHITE, 11).attacker_wins);
    }

    #[test]
    fn a_lost_defender_resists_in_the_fight() {
        // 碁盤 2 after 黒5-2 白5-1 黒4-1: white is lost, but capturing 4-1 (node 2) makes black
        // work longest. The search's own candidates never touched that stone.
        let (graph, stones) = grid6(&[3, 10, 16, 23], &[4, 9, 11]);
        let res = solve(&graph, &stones, WHITE, 11);
        assert!(res.attacker_wins);
        assert_eq!(res.best, Some(2));
        // ...and after 黒6-3 it connects at 6-1 (node 5) rather than playing far away, which is
        // what shows the snapback at 4-1.
        let (graph, stones) = grid6(&[10, 16, 17, 23], &[2, 4, 9, 11]);
        let res = solve(&graph, &stones, WHITE, 11);
        assert!(res.attacker_wins);
        assert_eq!(res.best, Some(5));
    }

    #[test]
    fn many_liberties_cannot_be_caught() {
        let (graph, stones) = grid6(&[0], &[14]);
        let res = solve(&graph, &stones, BLACK, 14);
        assert!(!res.attacker_wins);
    }

    #[test]
    fn a_missing_target_counts_as_captured() {
        let (graph, stones) = grid6(&[], &[]);
        assert!(solve(&graph, &stones, BLACK, 3).captured);
    }
}
