//! The game engine module.
//!
//! Exports (JSON in, JSON out — see `graph_go_core::abi`):
//!
//! - `play` — what happens when one move is put on the current position.
//! - `regions` — the empty regions of at least `minSize` nodes, each cut out as a subgraph.
//! - `evaluate` — scores the position: every region from `regions` is handed to the CPU module's
//!   judge, through the `cpu.judge` import the host wires to it, and smaller regions are settled
//!   here.

use graph_go_core::wire::{
    EvaluateRequest, EvaluateResponse, JudgeResponse, JudgedRegion, PlayRequest, PlayResponse,
    RegionOut, RegionsRequest, RegionsResponse, Subgraph, Tally,
};
use graph_go_core::{empty_regions, region, Board, Graph, BLACK, EMPTY, WHITE};

graph_go_core::export_abi!();
graph_go_core::export_json!(play, play_json);
graph_go_core::export_json!(regions, regions_json);
#[cfg(target_arch = "wasm32")]
graph_go_core::export_json!(evaluate, evaluate_json);

pub fn play_json(req: PlayRequest) -> Result<PlayResponse, String> {
    let graph = Graph::new(&req.position.graph)?;
    let mut board = Board::new(&graph, req.position.stones, req.position.ko)?;
    Ok(match board.play(req.color, req.node) {
        Ok(outcome) => PlayResponse {
            legal: true,
            reason: None,
            stones: board.stones,
            ko: outcome.ko,
            captured: outcome.captured,
            group: outcome.group,
            liberties: outcome.liberties,
            atari: outcome.atari,
        },
        Err(illegal) => PlayResponse {
            legal: false,
            reason: Some(illegal.as_str()),
            ko: board.ko,
            stones: board.stones,
            ..PlayResponse::default()
        },
    })
}

pub fn regions_json(req: RegionsRequest) -> Result<RegionsResponse, String> {
    let graph = Graph::new(&req.graph)?;
    let board = Board::new(&graph, req.stones, None)?;
    let regions = empty_regions(&board, req.min_size)
        .into_iter()
        .map(|r| RegionOut {
            subgraph: region::subgraph(&board, &r),
            nodes: r.nodes,
            boundary: r.boundary,
        })
        .collect();
    Ok(RegionsResponse { regions })
}

/// Area scoring: a player's stones plus the regions judged theirs, with komi added for white.
pub fn evaluate_with(
    req: EvaluateRequest,
    mut judge: impl FnMut(&Subgraph) -> Result<JudgeResponse, String>,
) -> Result<EvaluateResponse, String> {
    let graph = Graph::new(&req.graph)?;
    let board = Board::new(&graph, req.stones, None)?;
    let mut black = Tally {
        stones: board.stones.iter().filter(|&&c| c == BLACK).count(),
        ..Tally::default()
    };
    let mut white = Tally {
        stones: board.stones.iter().filter(|&&c| c == WHITE).count(),
        ..Tally::default()
    };

    let mut judged = Vec::new();
    for r in empty_regions(&board, 1) {
        let (owner, confidence, judged_by) = if r.nodes.len() >= req.min_size {
            let answer = judge(&region::subgraph(&board, &r))?;
            (answer.owner, answer.confidence, "cpu")
        } else {
            let (owner, confidence) = settle_small(&board, &r.boundary);
            (owner, confidence, "engine")
        };
        match owner {
            BLACK => black.territory += r.nodes.len(),
            WHITE => white.territory += r.nodes.len(),
            _ => {}
        }
        judged.push(JudgedRegion {
            nodes: r.nodes,
            owner,
            confidence,
            judged_by,
        });
    }

    black.score = (black.stones + black.territory) as f64;
    white.score = (white.stones + white.territory) as f64 + req.komi;
    let winner = if black.score > white.score {
        BLACK
    } else if white.score > black.score {
        WHITE
    } else {
        EMPTY
    };
    Ok(EvaluateResponse {
        black,
        white,
        komi: req.komi,
        winner,
        regions: judged,
    })
}

/// A small region belongs to whoever surrounds it alone, and to no one when both colours touch it.
fn settle_small(board: &Board, boundary: &[usize]) -> (u8, f64) {
    let touches = |color| boundary.iter().any(|&v| board.stones[v] == color);
    match (touches(BLACK), touches(WHITE)) {
        (true, false) => (BLACK, 1.0),
        (false, true) => (WHITE, 1.0),
        _ => (EMPTY, 1.0),
    }
}

#[cfg(target_arch = "wasm32")]
mod host {
    use super::*;

    #[link(wasm_import_module = "cpu")]
    extern "C" {
        /// Hands the subgraph (JSON) to the CPU module's `judge`; returns the answer's length.
        fn judge(ptr: *const u8, len: usize) -> usize;
        /// Copies that answer into `dst`.
        fn take_response(dst: *mut u8);
    }

    pub fn host_judge(subgraph: &Subgraph) -> Result<JudgeResponse, String> {
        let request = serde_json::to_vec(subgraph).map_err(|e| e.to_string())?;
        let len = unsafe { judge(request.as_ptr(), request.len()) };
        let mut answer = vec![0u8; len];
        unsafe { take_response(answer.as_mut_ptr()) };
        serde_json::from_slice::<JudgeResponse>(&answer).map_err(|_| {
            serde_json::from_slice::<serde_json::Value>(&answer)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
                .unwrap_or_else(|| "the CPU module's judge answered something unreadable".into())
        })
    }
}

#[cfg(target_arch = "wasm32")]
fn evaluate_json(req: EvaluateRequest) -> Result<EvaluateResponse, String> {
    evaluate_with(req, host::host_judge)
}

#[cfg(test)]
mod tests {
    use super::*;
    use graph_go_core::wire::{GraphSpec, Position};

    fn path(n: usize) -> GraphSpec {
        GraphSpec {
            node_count: n,
            edges: (0..n - 1).map(|i| [i, i + 1]).collect(),
        }
    }

    #[test]
    fn play_reports_illegal_moves_without_changing_the_board() {
        let res = play_json(PlayRequest {
            position: Position {
                graph: path(3),
                stones: vec![0, 1, 0],
                ko: None,
            },
            color: WHITE,
            node: Some(1),
        })
        .unwrap();
        assert!(!res.legal);
        assert_eq!(res.reason, Some("occupied"));
        assert_eq!(res.stones, vec![0, 1, 0]);
    }

    #[test]
    fn evaluate_sends_large_regions_to_the_judge_only() {
        // . . . B W .
        let mut asked = Vec::new();
        let res = evaluate_with(
            EvaluateRequest {
                graph: path(6),
                stones: vec![0, 0, 0, 1, 2, 0],
                min_size: 2,
                komi: 0.5,
            },
            |s| {
                asked.push(s.origin.clone());
                Ok(JudgeResponse {
                    owner: BLACK,
                    confidence: 1.0,
                    node_owners: vec![BLACK; s.node_count],
                })
            },
        )
        .unwrap();
        assert_eq!(asked, vec![vec![0, 1, 2, 3]]);
        assert_eq!(res.black.score, 4.0);
        assert_eq!(res.white.score, 2.5);
        assert_eq!(res.winner, BLACK);
        assert_eq!(res.regions[1].judged_by, "engine");
        assert_eq!(res.regions[1].owner, WHITE);
    }
}
