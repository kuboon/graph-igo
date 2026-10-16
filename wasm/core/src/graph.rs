//! The board's shape: an undirected graph in compressed adjacency form.

use crate::wire::GraphSpec;

#[derive(Clone, Debug)]
pub struct Graph {
    offsets: Vec<usize>,
    adjacency: Vec<usize>,
}

impl Graph {
    /// Builds the adjacency from an edge list. Self-loops and duplicate edges are dropped, since
    /// neither changes who is next to whom.
    pub fn new(spec: &GraphSpec) -> Result<Graph, String> {
        let n = spec.node_count;
        let mut lists: Vec<Vec<usize>> = vec![Vec::new(); n];
        for &[a, b] in &spec.edges {
            if a >= n || b >= n {
                return Err(format!("edge [{a}, {b}] is outside 0..{n}"));
            }
            if a == b {
                continue;
            }
            lists[a].push(b);
            lists[b].push(a);
        }
        let mut offsets = Vec::with_capacity(n + 1);
        let mut adjacency = Vec::new();
        offsets.push(0);
        for mut list in lists {
            list.sort_unstable();
            list.dedup();
            adjacency.extend(list);
            offsets.push(adjacency.len());
        }
        Ok(Graph { offsets, adjacency })
    }

    pub fn len(&self) -> usize {
        self.offsets.len() - 1
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn neighbors(&self, node: usize) -> &[usize] {
        &self.adjacency[self.offsets[node]..self.offsets[node + 1]]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drops_loops_and_duplicates() {
        let g = Graph::new(&GraphSpec {
            node_count: 3,
            edges: vec![[0, 1], [1, 0], [1, 1], [1, 2]],
        })
        .unwrap();
        assert_eq!(g.neighbors(0), &[1]);
        assert_eq!(g.neighbors(1), &[0, 2]);
        assert_eq!(g.neighbors(2), &[1]);
    }

    #[test]
    fn rejects_out_of_range_edges() {
        assert!(Graph::new(&GraphSpec {
            node_count: 2,
            edges: vec![[0, 2]],
        })
        .is_err());
    }
}
