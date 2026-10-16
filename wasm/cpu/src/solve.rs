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
                    best: self.pressing(board, &liberties),
                };
            }
            // The losing attacker's move is still worth showing, so it is the one that leaves the
            // target the fewest liberties: the try a reader would look at first.
            let mut pressing: Option<(usize, usize)> = None;
            for mv in self.attacker_moves(&mut scratch, &liberties) {
                let mut next = board.clone();
                if next.play_quick(to_move, mv).is_err() {
                    continue;
                }
                let left = if next.stones[self.target] == EMPTY {
                    0
                } else {
                    next.liberties(self.target)
                };
                if pressing.is_none_or(|(fewest, _)| left < fewest) {
                    pressing = Some((left, mv));
                }
                if self.read(&next, opponent(to_move), depth - 1).attacker_wins {
                    return Outcome {
                        attacker_wins: true,
                        best: Some(mv),
                    };
                }
            }
            Outcome {
                attacker_wins: false,
                best: pressing.map(|(_, mv)| mv),
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

    /// Of `candidates`, the legal attacking move that leaves the target the fewest liberties.
    fn pressing(&self, board: &Board, candidates: &[usize]) -> Option<usize> {
        let mut best: Option<(usize, usize)> = None;
        for &mv in candidates {
            let mut next = board.clone();
            if next.play_quick(self.attacker, mv).is_err() {
                continue;
            }
            let left = if next.stones[self.target] == EMPTY {
                0
            } else {
                next.liberties(self.target)
            };
            if best.is_none_or(|(fewest, _)| left < fewest) {
                best = Some((left, mv));
            }
        }
        best.map(|(_, mv)| mv)
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
        let defender = board.stones[self.target];
        // The stones the counter-attack protects: the target's group, and the friendly groups next
        // to its liberties, which it can connect to. Capturing an attacker that touches any of them
        // can open a way out — the stone taken is not always the one doing the surrounding.
        let mut guarded = Vec::new();
        board.group_of(self.target, &mut guarded);
        let mut group = Vec::new();
        for &l in liberties {
            for &u in board.graph.neighbors(l) {
                if board.stones[u] == defender && !guarded.contains(&u) {
                    board.group_of(u, &mut group);
                    guarded.extend_from_slice(&group);
                }
            }
        }
        // Counter-attacks: attacking groups touching those stones that are short of liberties.
        let mut seen = Vec::new();
        for &s in &guarded {
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

/// The move to show for the side to move, once the reading has decided who wins.
///
/// The search stops at the first move that settles the question, which is enough for a verdict
/// but not for a reply worth watching. So when the attacker wins it plays the *fastest* capture,
/// and when the defender loses anyway it plays the *most stubborn* move — the one that makes the
/// attacker need the most moves — tried over every legal move, not only the ones the search
/// considers. (Losing attackers and winning defenders already get a fitting move from `read`.)
pub fn showcase_move(
    reader: &mut Reader,
    board: &Board,
    to_move: Color,
    max_depth: u32,
    outcome: &Outcome,
) -> Option<usize> {
    if !outcome.attacker_wins {
        return outcome.best;
    }
    let after = |reader: &mut Reader, mv: Option<usize>, depth: u32| -> Option<bool> {
        let mut next = board.clone();
        match mv {
            Some(v) => next.play_quick(to_move, v).ok()?,
            None => {
                next.ko = None;
                0
            }
        };
        Some(reader.read(&next, opponent(to_move), depth).attacker_wins)
    };
    let empties: Vec<usize> = (0..board.len())
        .filter(|&v| board.stones[v] == EMPTY)
        .collect();
    if to_move == reader.attacker {
        // The shallowest depth at which some move already wins.
        for depth in 0..max_depth {
            for &v in &empties {
                if after(reader, Some(v), depth) == Some(true) {
                    return Some(v);
                }
            }
        }
        outcome.best
    } else {
        // For each move, the shallowest depth at which the attacker still wins; keep the deepest.
        // Ties go to the move that takes stones, then to the one leaving the target the most
        // liberties, then to the one that makes its group biggest: a stone played far away holds
        // out just as long, and shows nothing, where connecting shows how the group is lost.
        let mut best = outcome.best;
        let mut longest = (0, 0, 0, 0);
        for mv in empties.iter().map(|&v| Some(v)).chain([None]) {
            let mut needed = None;
            for depth in 0..max_depth {
                match after(reader, mv, depth) {
                    None => break,
                    Some(true) => {
                        needed = Some(depth);
                        break;
                    }
                    Some(false) => {}
                }
            }
            // A legal move the attacker cannot answer in time at all: the search's narrower
            // candidates missed it, and it is the best defence there is.
            let needed = match needed {
                Some(d) => d,
                None if after(reader, mv, 0).is_some() => max_depth,
                None => continue,
            };
            let mut next = board.clone();
            let captures = match mv {
                Some(v) => next.play_quick(to_move, v).unwrap_or(0),
                None => 0,
            };
            let mut group = Vec::new();
            let liberties = next.group_of(reader.target, &mut group);
            let score = (needed, captures, liberties, group.len());
            if score > longest {
                longest = score;
                best = mv;
            }
        }
        best
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
