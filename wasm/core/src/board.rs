//! A position, and what one move does to it.

use crate::{is_player, opponent, Color, Graph, EMPTY};

/// Why a move was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Illegal {
    OutOfRange,
    InvalidColor,
    Occupied,
    /// Retaking a single stone that just captured a single stone.
    Ko,
    /// The placed stone's group would have no liberties and captures nothing.
    Suicide,
}

impl Illegal {
    pub fn as_str(self) -> &'static str {
        match self {
            Illegal::OutOfRange => "outOfRange",
            Illegal::InvalidColor => "invalidColor",
            Illegal::Occupied => "occupied",
            Illegal::Ko => "ko",
            Illegal::Suicide => "suicide",
        }
    }
}

/// What a legal move did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PlayOutcome {
    /// Opponent stones removed, in the order they were found.
    pub captured: Vec<usize>,
    /// The node the opponent may not play on next turn, if the move made a ko.
    pub ko: Option<usize>,
    /// Liberties of the group the placed stone ended up in. Zero for a pass.
    pub liberties: usize,
    /// The placed stone's whole group, the stone included.
    pub group: Vec<usize>,
    /// Opponent stones whose group the move left with one liberty.
    pub atari: Vec<usize>,
}

#[derive(Clone, Debug)]
pub struct Board<'g> {
    pub graph: &'g Graph,
    pub stones: Vec<Color>,
    pub ko: Option<usize>,
    /// Flood-fill visit stamps. A node is visited in the current fill when its stamp equals `epoch`,
    /// so a fill costs nothing to reset.
    stone_mark: Vec<u32>,
    liberty_mark: Vec<u32>,
    epoch: u32,
    stack: Vec<usize>,
    scratch: Vec<usize>,
}

impl<'g> Board<'g> {
    pub fn new(graph: &'g Graph, stones: Vec<Color>, ko: Option<usize>) -> Result<Self, String> {
        let n = graph.len();
        if stones.len() != n {
            return Err(format!(
                "stones has {} entries but the graph has {n} nodes",
                stones.len()
            ));
        }
        if let Some(&bad) = stones.iter().find(|&&c| c > 2) {
            return Err(format!("stone value {bad} is not 0, 1 or 2"));
        }
        Ok(Board {
            graph,
            stones,
            ko: ko.filter(|&k| k < n),
            stone_mark: vec![0; n],
            liberty_mark: vec![0; n],
            epoch: 0,
            stack: Vec::new(),
            scratch: Vec::new(),
        })
    }

    pub fn empty(graph: &'g Graph) -> Self {
        Board::new(graph, vec![EMPTY; graph.len()], None).expect("an empty board is valid")
    }

    pub fn len(&self) -> usize {
        self.stones.len()
    }

    pub fn is_empty(&self) -> bool {
        self.stones.is_empty()
    }

    fn next_epoch(&mut self) -> u32 {
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.stone_mark.fill(0);
            self.liberty_mark.fill(0);
            self.epoch = 1;
        }
        self.epoch
    }

    /// The group containing `start`, and how many liberties it has. `out` is cleared and filled.
    pub fn group_of(&mut self, start: usize, out: &mut Vec<usize>) -> usize {
        out.clear();
        let color = self.stones[start];
        let epoch = self.next_epoch();
        let mut liberties = 0;
        self.stack.clear();
        self.stack.push(start);
        self.stone_mark[start] = epoch;
        while let Some(v) = self.stack.pop() {
            out.push(v);
            for &u in self.graph.neighbors(v) {
                let c = self.stones[u];
                if c == color {
                    if self.stone_mark[u] != epoch {
                        self.stone_mark[u] = epoch;
                        self.stack.push(u);
                    }
                } else if c == EMPTY && self.liberty_mark[u] != epoch {
                    self.liberty_mark[u] = epoch;
                    liberties += 1;
                }
            }
        }
        liberties
    }

    /// Liberty count of the group at `node`.
    pub fn liberties(&mut self, node: usize) -> usize {
        let mut scratch = Vec::new();
        self.group_of(node, &mut scratch)
    }

    /// An empty node every neighbour of which is `color`: filling it can only hurt that player.
    pub fn is_eye(&self, node: usize, color: Color) -> bool {
        let neighbors = self.graph.neighbors(node);
        !neighbors.is_empty()
            && self.stones[node] == EMPTY
            && neighbors.iter().all(|&u| self.stones[u] == color)
    }

    /// Plays `color` at `node` (`None` passes). On an illegal move the board is unchanged.
    pub fn play(&mut self, color: Color, node: Option<usize>) -> Result<PlayOutcome, Illegal> {
        if !is_player(color) {
            return Err(Illegal::InvalidColor);
        }
        let Some(v) = node else {
            self.ko = None;
            return Ok(PlayOutcome::default());
        };
        if v >= self.len() {
            return Err(Illegal::OutOfRange);
        }
        if self.stones[v] != EMPTY {
            return Err(Illegal::Occupied);
        }
        if self.ko == Some(v) {
            return Err(Illegal::Ko);
        }

        let enemy = opponent(color);
        self.stones[v] = color;
        let mut captured = Vec::new();
        let mut group = Vec::new();
        let graph = self.graph;
        for &u in graph.neighbors(v) {
            if self.stones[u] != enemy {
                continue;
            }
            if self.group_of(u, &mut group) == 0 {
                for &s in &group {
                    self.stones[s] = EMPTY;
                }
                captured.extend_from_slice(&group);
            }
        }

        let liberties = self.group_of(v, &mut group);
        if liberties == 0 {
            // Nothing was captured, or the group would have a liberty where the captures were.
            self.stones[v] = EMPTY;
            return Err(Illegal::Suicide);
        }

        self.ko = if captured.len() == 1 && group.len() == 1 && liberties == 1 {
            Some(captured[0])
        } else {
            None
        };

        let mut atari = Vec::new();
        let mut enemy_group = Vec::new();
        for &u in graph.neighbors(v) {
            if self.stones[u] != enemy || atari.contains(&u) {
                continue;
            }
            if self.group_of(u, &mut enemy_group) == 1 {
                atari.extend_from_slice(&enemy_group);
            }
        }

        Ok(PlayOutcome {
            ko: self.ko,
            captured,
            liberties,
            group,
            atari,
        })
    }

    /// Whether the group at `start` has a liberty. Stops at the first one, so it is much cheaper
    /// than counting them.
    pub fn has_liberty(&mut self, start: usize) -> bool {
        let color = self.stones[start];
        let epoch = self.next_epoch();
        let graph = self.graph;
        self.stack.clear();
        self.stack.push(start);
        self.stone_mark[start] = epoch;
        while let Some(v) = self.stack.pop() {
            for &u in graph.neighbors(v) {
                let c = self.stones[u];
                if c == EMPTY {
                    return true;
                }
                if c == color && self.stone_mark[u] != epoch {
                    self.stone_mark[u] = epoch;
                    self.stack.push(u);
                }
            }
        }
        false
    }

    /// [`Board::play`] without the report: the same rules, for playing many games out fast.
    /// Returns how many stones were captured.
    pub fn play_quick(&mut self, color: Color, v: usize) -> Result<usize, Illegal> {
        if self.stones[v] != EMPTY {
            return Err(Illegal::Occupied);
        }
        if self.ko == Some(v) {
            return Err(Illegal::Ko);
        }
        let enemy = opponent(color);
        let graph = self.graph;
        self.stones[v] = color;
        let mut captured = 0;
        let mut last_captured = 0;
        for &u in graph.neighbors(v) {
            if self.stones[u] == enemy && !self.has_liberty(u) {
                let mut group = std::mem::take(&mut self.scratch);
                self.group_of(u, &mut group);
                for &s in &group {
                    self.stones[s] = EMPTY;
                }
                captured += group.len();
                last_captured = u;
                self.scratch = group;
            }
        }
        if captured == 0 && !self.has_liberty(v) {
            self.stones[v] = EMPTY;
            return Err(Illegal::Suicide);
        }
        let neighbors = graph.neighbors(v);
        self.ko = if captured == 1
            && neighbors.iter().all(|&u| self.stones[u] != color)
            && neighbors
                .iter()
                .filter(|&&u| self.stones[u] == EMPTY)
                .count()
                == 1
        {
            Some(last_captured)
        } else {
            None
        };
        Ok(captured)
    }

    /// Whether `color` may play at `node` right now, without changing the board.
    pub fn is_legal(&mut self, color: Color, node: usize) -> bool {
        if node >= self.len() || self.stones[node] != EMPTY || self.ko == Some(node) {
            return false;
        }
        let enemy = opponent(color);
        // A liberty next to the stone makes it legal outright.
        if self
            .graph
            .neighbors(node)
            .iter()
            .any(|&u| self.stones[u] == EMPTY)
        {
            return true;
        }
        self.stones[node] = color;
        let mut legal = false;
        let graph = self.graph;
        for &u in graph.neighbors(node) {
            if self.stones[u] == enemy && !self.has_liberty(u) {
                legal = true;
                break;
            }
        }
        if !legal {
            legal = self.has_liberty(node);
        }
        self.stones[node] = EMPTY;
        legal
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::GraphSpec;
    use crate::{BLACK, WHITE};

    /// A `w` × `h` square grid, numbered row by row.
    pub fn grid(w: usize, h: usize) -> Graph {
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
        Graph::new(&GraphSpec {
            node_count: w * h,
            edges,
        })
        .unwrap()
    }

    #[test]
    fn captures_a_surrounded_stone() {
        let g = grid(3, 3);
        let mut b = Board::empty(&g);
        b.play(WHITE, Some(4)).unwrap();
        b.play(BLACK, Some(1)).unwrap();
        b.play(BLACK, Some(3)).unwrap();
        b.play(BLACK, Some(5)).unwrap();
        let out = b.play(BLACK, Some(7)).unwrap();
        assert_eq!(out.captured, vec![4]);
        assert_eq!(b.stones[4], EMPTY);
    }

    #[test]
    fn refuses_suicide_and_occupied() {
        let g = grid(3, 3);
        let mut b = Board::empty(&g);
        for v in [1, 3] {
            b.play(BLACK, Some(v)).unwrap();
        }
        assert_eq!(b.play(WHITE, Some(0)), Err(Illegal::Suicide));
        assert_eq!(b.stones[0], EMPTY);
        assert_eq!(b.play(WHITE, Some(1)), Err(Illegal::Occupied));
        assert!(!b.is_legal(WHITE, 0));
        assert!(b.is_legal(BLACK, 0));
    }

    #[test]
    fn simple_ko_is_refused_until_a_move_elsewhere() {
        // . B W .
        // B W . W
        // . B W .
        let g = grid(4, 3);
        let mut b = Board::empty(&g);
        for v in [1, 4, 9] {
            b.play(BLACK, Some(v)).unwrap();
        }
        for v in [2, 5, 7, 10] {
            b.play(WHITE, Some(v)).unwrap();
        }
        let out = b.play(BLACK, Some(6)).unwrap();
        assert_eq!(out.captured, vec![5]);
        assert_eq!(out.ko, Some(5));
        assert_eq!(b.play(WHITE, Some(5)), Err(Illegal::Ko));
        assert!(!b.is_legal(WHITE, 5));
        b.play(WHITE, None).unwrap();
        assert_eq!(b.ko, None);
    }

    #[test]
    fn play_quick_agrees_with_play() {
        // Replays the ko position move by move with both and compares the boards.
        let g = grid(4, 3);
        let moves = [
            (BLACK, 1),
            (WHITE, 2),
            (BLACK, 4),
            (WHITE, 5),
            (BLACK, 9),
            (WHITE, 7),
        ];
        let mut full = Board::empty(&g);
        let mut quick = Board::empty(&g);
        for (c, v) in moves.into_iter().chain([(WHITE, 10), (BLACK, 6)]) {
            full.play(c, Some(v)).unwrap();
            quick.play_quick(c, v).unwrap();
            assert_eq!(full.stones, quick.stones);
            assert_eq!(full.ko, quick.ko);
        }
        assert_eq!(quick.play_quick(WHITE, 5), Err(Illegal::Ko));
        assert_eq!(quick.play_quick(WHITE, 0), Err(Illegal::Suicide));
    }

    #[test]
    fn reports_atari() {
        let g = grid(4, 1);
        let mut b = Board::empty(&g);
        b.play(WHITE, Some(1)).unwrap();
        let out = b.play(BLACK, Some(2)).unwrap();
        assert_eq!(out.atari, vec![1]);
    }

    #[test]
    fn works_on_a_triangle() {
        // Every node touches the other two: two stones of one colour kill the third.
        let g = Graph::new(&GraphSpec {
            node_count: 3,
            edges: vec![[0, 1], [1, 2], [2, 0]],
        })
        .unwrap();
        let mut b = Board::empty(&g);
        b.play(WHITE, Some(0)).unwrap();
        b.play(BLACK, Some(1)).unwrap();
        let out = b.play(BLACK, Some(2)).unwrap();
        assert_eq!(out.captured, vec![0]);
    }
}
