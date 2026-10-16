//! Reading out a capture: can the attacker take the target group, whoever moves first?
//!
//! A depth-limited AND/OR search over the moves that matter to the fight, as a person reads a
//! ladder or a net:
//!
//! - the attacker tries the target's liberties, and when the target is short of them, the points
//!   next to those liberties too (that is where a net is played);
//! - the defender tries the target's liberties, and the liberties of attacking groups it could
//!   capture or put in atari, plus passing — sometimes the best defence is to change nothing.
//!
//! The defender wins whatever the search cannot prove the attacker wins within the depth, so a
//! deep enough limit is part of a problem's statement.

use graph_go_core::{opponent, Board, Color, EMPTY};

pub struct Outcome {
    pub attacker_wins: bool,
    pub best: Option<usize>,
}

pub struct Reader {
    pub target: usize,
    pub attacker: Color,
    pub visited: u64,
}

impl Reader {
    /// Reads from `board` with `to_move` to play and `depth` moves left.
    pub fn read(&mut self, board: &Board, to_move: Color, depth: u32) -> Outcome {
        self.visited += 1;
        if board.stones[self.target] == EMPTY {
            return Outcome {
                attacker_wins: true,
                best: None,
            };
        }
        if depth == 0 {
            return Outcome {
                attacker_wins: false,
                best: None,
            };
        }
        let mut scratch = board.clone();
        let liberties = liberty_points(&mut scratch, self.target);
        if to_move == self.attacker {
            // Every attacking move takes at most one liberty, and every defending move between them
            // may add some back, so a target with too many liberties cannot be caught in time.
            if liberties.len() as u32 > depth.div_ceil(2) {
                return Outcome {
                    attacker_wins: false,
                    best: liberties.first().copied(),
                };
            }
            let mut first_legal = None;
            for mv in self.attacker_moves(&mut scratch, &liberties) {
                let mut next = board.clone();
                if next.play_quick(to_move, mv).is_err() {
                    continue;
                }
                first_legal.get_or_insert(mv);
                if self.read(&next, opponent(to_move), depth - 1).attacker_wins {
                    return Outcome {
                        attacker_wins: true,
                        best: Some(mv),
                    };
                }
            }
            Outcome {
                attacker_wins: false,
                best: first_legal,
            }
        } else {
            let mut stubborn = None;
            for mv in self.defender_moves(&mut scratch, &liberties) {
                let mut next = board.clone();
                if let Some(v) = mv {
                    if next.play_quick(to_move, v).is_err() {
                        continue;
                    }
                } else {
                    next.ko = None;
                }
                stubborn.get_or_insert(mv);
                if !self.read(&next, opponent(to_move), depth - 1).attacker_wins {
                    return Outcome {
                        attacker_wins: false,
                        best: mv,
                    };
                }
            }
            Outcome {
                attacker_wins: true,
                best: stubborn.flatten(),
            }
        }
    }

    fn attacker_moves(&self, board: &mut Board, liberties: &[usize]) -> Vec<usize> {
        let mut moves = liberties.to_vec();
        if liberties.len() <= 2 {
            for &l in liberties {
                for &u in board.graph.neighbors(l) {
                    if board.stones[u] == EMPTY && !moves.contains(&u) {
                        moves.push(u);
                    }
                }
            }
        }
        moves
    }

    fn defender_moves(&self, board: &mut Board, liberties: &[usize]) -> Vec<Option<usize>> {
        let mut moves: Vec<Option<usize>> = liberties.iter().map(|&l| Some(l)).collect();
        // Counter-attacks: attacking groups touching the target that are short of liberties.
        let mut group = Vec::new();
        board.group_of(self.target, &mut group);
        let mut seen = Vec::new();
        for &s in &group {
            for &u in board.graph.neighbors(s) {
                if board.stones[u] != self.attacker || seen.contains(&u) {
                    continue;
                }
                let mut enemy = Vec::new();
                board.group_of(u, &mut enemy);
                seen.extend_from_slice(&enemy);
                let points = liberty_points(board, u);
                if points.len() <= 2 {
                    for p in points {
                        if !moves.contains(&Some(p)) {
                            moves.push(Some(p));
                        }
                    }
                }
            }
        }
        moves.push(None);
        moves
    }
}

/// The empty nodes next to the group at `node`, ascending.
fn liberty_points(board: &mut Board, node: usize) -> Vec<usize> {
    let mut group = Vec::new();
    board.group_of(node, &mut group);
    let mut points = Vec::new();
    for &s in &group {
        for &u in board.graph.neighbors(s) {
            if board.stones[u] == EMPTY && !points.contains(&u) {
                points.push(u);
            }
        }
    }
    points.sort_unstable();
    points
}
