//! Empty regions: connected runs of empty nodes, and the subgraph a judge needs to see one.

use crate::wire::Subgraph;
use crate::{Board, EMPTY};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Region {
    /// The empty nodes, ascending.
    pub nodes: Vec<usize>,
    /// The stones adjacent to the region, ascending.
    pub boundary: Vec<usize>,
}

/// Every connected component of empty nodes with at least `min_size` nodes, ordered by its
/// smallest node.
pub fn empty_regions(board: &Board, min_size: usize) -> Vec<Region> {
    let n = board.len();
    let graph = board.graph;
    let mut seen = vec![false; n];
    let mut on_boundary = vec![false; n];
    let mut regions = Vec::new();
    let mut stack = Vec::new();
    for start in 0..n {
        if seen[start] || board.stones[start] != EMPTY {
            continue;
        }
        let mut nodes = Vec::new();
        let mut boundary = Vec::new();
        seen[start] = true;
        stack.push(start);
        while let Some(v) = stack.pop() {
            nodes.push(v);
            for &u in graph.neighbors(v) {
                if board.stones[u] == EMPTY {
                    if !seen[u] {
                        seen[u] = true;
                        stack.push(u);
                    }
                } else if !on_boundary[u] {
                    on_boundary[u] = true;
                    boundary.push(u);
                }
            }
        }
        for &b in &boundary {
            on_boundary[b] = false;
        }
        if nodes.len() >= min_size.max(1) {
            nodes.sort_unstable();
            boundary.sort_unstable();
            regions.push(Region { nodes, boundary });
        }
    }
    regions
}

/// The region and its boundary stones as a graph of their own: the subgraph of the board induced
/// on those nodes, renumbered from zero. `origin[i]` is the board node local node `i` came from;
/// the region's nodes come first, then the boundary.
pub fn subgraph(board: &Board, region: &Region) -> Subgraph {
    let origin: Vec<usize> = region
        .nodes
        .iter()
        .chain(region.boundary.iter())
        .copied()
        .collect();
    let mut local = vec![usize::MAX; board.len()];
    for (i, &v) in origin.iter().enumerate() {
        local[v] = i;
    }
    let mut edges = Vec::new();
    for (i, &v) in origin.iter().enumerate() {
        for &u in board.graph.neighbors(v) {
            let j = local[u];
            if j != usize::MAX && i < j {
                edges.push([i, j]);
            }
        }
    }
    Subgraph {
        node_count: origin.len(),
        edges,
        stones: origin.iter().map(|&v| board.stones[v]).collect(),
        origin,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::GraphSpec;
    use crate::{Graph, BLACK, WHITE};

    fn path(n: usize) -> Graph {
        Graph::new(&GraphSpec {
            node_count: n,
            edges: (0..n - 1).map(|i| [i, i + 1]).collect(),
        })
        .unwrap()
    }

    #[test]
    fn splits_by_stones_and_filters_by_size() {
        // . . B . W . .
        let g = path(7);
        let b = Board::new(&g, vec![0, 0, BLACK, 0, WHITE, 0, 0], None).unwrap();
        let all = empty_regions(&b, 1);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].nodes, vec![0, 1]);
        assert_eq!(all[0].boundary, vec![2]);
        assert_eq!(all[1].nodes, vec![3]);
        assert_eq!(all[1].boundary, vec![2, 4]);
        assert_eq!(empty_regions(&b, 2).len(), 2);
    }

    #[test]
    fn subgraph_is_induced_and_renumbered() {
        let g = path(7);
        let b = Board::new(&g, vec![0, 0, BLACK, 0, WHITE, 0, 0], None).unwrap();
        let r = &empty_regions(&b, 1)[1];
        let s = subgraph(&b, r);
        assert_eq!(s.origin, vec![3, 2, 4]);
        assert_eq!(s.stones, vec![0, BLACK, WHITE]);
        assert_eq!(s.edges, vec![[0, 1], [0, 2]]);
    }
}
