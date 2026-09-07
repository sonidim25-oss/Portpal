use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct GraphNode {
    pub id: String,
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub project_name: Option<String>,
    pub framework: Option<String>,
    pub is_dev: bool,
    pub connection_count: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub active: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct PortGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

const DEV_PORTS: &[(u16, &str)] = &[
    (3000, "React"), (3001, "React"), (4000, "Node"),
    (4200, "Angular"), (5173, "Vite"), (5174, "Vite"),
    (8000, "Django"), (8080, "HTTP"), (8888, "Jupyter"),
    (5432, "Postgres"), (3306, "MySQL"), (6379, "Redis"),
    (27017, "Mongo"), (9000, "PHP"), (1420, "Tauri"),
    (4173, "Vite"), (2000, "Node"), (8443, "HTTPS"),
];

fn get_framework(port: u16) -> Option<String> {
    DEV_PORTS.iter()
        .find(|(p, _)| *p == port)
        .map(|(_, f)| f.to_string())
}

pub fn get_framework_name(port: u16) -> Option<String> {
    get_framework(port)
}

fn is_dev_port(port: u16) -> bool {
    DEV_PORTS.iter().any(|(p, _)| *p == port)
}

/// Stable endpoint identity: ports are NOT unique (SO_REUSEADDR conflicts,
/// v4/v6 dual-binds, stale rows), so nodes are keyed by (port, pid) and ids
/// use the format `port:{port}:{pid}`. The legacy `port:{port}` format dropped
/// conflicting listeners sharing a port.
type NodeKey = (u16, u32);

fn node_id(port: u16, pid: u32) -> String {
    format!("port:{}:{}", port, pid)
}

pub fn get_port_graph(
    listening: &[(u16, u32, String, Option<String>)],
) -> PortGraph {
    // listening: (port, pid, process_name, project_name)
    let connections = get_active_connections();

    // Build node map from listening ports, keyed by endpoint identity so
    // conflicting listeners on the same port each keep their node.
    let mut node_map: HashMap<NodeKey, GraphNode> = HashMap::new();
    for (port, pid, process_name, project_name) in listening {
        node_map.insert((*port, *pid), GraphNode {
            id: node_id(*port, *pid),
            port: *port,
            pid: *pid,
            process_name: process_name.clone(),
            project_name: project_name.clone(),
            framework: get_framework(*port),
            is_dev: is_dev_port(*port),
            connection_count: 0,
        });
    }

    // Build PID → listening endpoint lookup
    let mut pid_to_keys: HashMap<u32, Vec<NodeKey>> = HashMap::new();
    for (port, pid, _, _) in listening {
        pid_to_keys.entry(*pid).or_default().push((*port, *pid));
    }

    // Build port → endpoint lookup for direct port matches
    let mut port_to_keys: HashMap<u16, Vec<NodeKey>> = HashMap::new();
    for key in node_map.keys() {
        port_to_keys.entry(key.0).or_default().push(*key);
    }
    let has_listeners = |port: u16| port_to_keys.get(&port).map(|v| !v.is_empty()).unwrap_or(false);

    // Build edges from active connections
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut seen_edges: HashSet<(NodeKey, NodeKey)> = HashSet::new();

    for (src_port, dst_port, src_pid, dst_pid) in &connections {
        // Strategy 1: both ports are known listening ports (direct match).
        // On a port conflict every listener on each side gets an edge.
        let src_listen = has_listeners(*src_port);
        let dst_listen = has_listeners(*dst_port);

        if src_listen && dst_listen {
            let empty: Vec<NodeKey> = Vec::new();
            let src_keys = port_to_keys.get(src_port).unwrap_or(&empty).clone();
            let dst_keys = port_to_keys.get(dst_port).unwrap_or(&empty).clone();
            for a in &src_keys {
                for b in &dst_keys {
                    if a != b {
                        add_edge(&mut edges, &mut seen_edges, &mut node_map, *a, *b);
                    }
                }
            }
            continue;
        }

        // Strategy 2: one side is a listening port, other side's PID owns a different listening port
        // This catches ephemeral-port connections (client connects to server on a random port)
        if dst_listen {
            // dst_port is a server; src_pid might own another listening port
            if let Some(src_keys) = pid_to_keys.get(src_pid) {
                let empty: Vec<NodeKey> = Vec::new();
                let dst_keys = port_to_keys.get(dst_port).unwrap_or(&empty).clone();
                for sp in src_keys.clone() {
                    for dp in &dst_keys {
                        if sp != *dp {
                            add_edge(&mut edges, &mut seen_edges, &mut node_map, sp, *dp);
                        }
                    }
                }
            }
        }
        if src_listen {
            // src_port is a server; dst_pid might own another listening port
            if let Some(dst_keys) = pid_to_keys.get(dst_pid) {
                let empty: Vec<NodeKey> = Vec::new();
                let src_keys = port_to_keys.get(src_port).unwrap_or(&empty).clone();
                for dp in dst_keys.clone() {
                    for sp in &src_keys {
                        if *sp != dp {
                            add_edge(&mut edges, &mut seen_edges, &mut node_map, *sp, dp);
                        }
                    }
                }
            }
        }
    }

    PortGraph {
        nodes: node_map.into_values().collect(),
        edges,
    }
}

fn add_edge(
    edges: &mut Vec<GraphEdge>,
    seen: &mut HashSet<(NodeKey, NodeKey)>,
    node_map: &mut HashMap<NodeKey, GraphNode>,
    a: NodeKey, b: NodeKey,
) {
    let key = if a < b { (a, b) } else { (b, a) };
    if seen.insert(key) {
        edges.push(GraphEdge {
            source: node_id(a.0, a.1),
            target: node_id(b.0, b.1),
            active: true,
        });
        if let Some(n) = node_map.get_mut(&a) {
            n.connection_count += 1;
        }
        if let Some(n) = node_map.get_mut(&b) {
            n.connection_count += 1;
        }
    }
}

fn get_active_connections() -> Vec<(u16, u16, u32, u32)> {
    #[cfg(target_os = "windows")]
    return get_connections_windows();

    #[cfg(target_os = "macos")]
    return get_connections_macos();

    #[cfg(target_os = "linux")]
    return get_connections_linux();
}

#[cfg(target_os = "windows")]
fn get_connections_windows() -> Vec<(u16, u16, u32, u32)> {
    // Use netstat -ano to get all ESTABLISHED connections with PIDs
    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // First pass: build a port→pid map from ESTABLISHED lines
    // netstat format: Proto  Local Address  Foreign Address  State  PID
    let mut raw_conns: Vec<(u16, u16, u32)> = Vec::new();

    for line in stdout.lines() {
        if !line.contains("ESTABLISHED") { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 { continue; }

        let src_port = parts[1].rsplit(':').next()
            .and_then(|p| p.parse::<u16>().ok());
        let dst_port = parts[2].rsplit(':').next()
            .and_then(|p| p.parse::<u16>().ok());
        let pid: Option<u32> = parts[4].parse().ok();

        if let (Some(s), Some(d), Some(p)) = (src_port, dst_port, pid) {
            if p == 0 { continue; }
            raw_conns.push((s, d, p));
        }
    }

    // Build a port→pid lookup from all connections so we can find the PID for each side
    let mut port_pid: HashMap<u16, u32> = HashMap::new();
    for (s, _d, pid) in &raw_conns {
        port_pid.insert(*s, *pid);
        // For the destination, we may find its PID from another connection where it's the source
    }

    // Now pair connections: for each (src, dst, pid), find the dst's PID
    let mut conns: Vec<(u16, u16, u32, u32)> = Vec::new();
    for (s, d, src_pid) in &raw_conns {
        let dst_pid = port_pid.get(d).copied().unwrap_or(0);
        conns.push((*s, *d, *src_pid, dst_pid));
    }

    conns
}

#[cfg(target_os = "macos")]
fn get_connections_macos() -> Vec<(u16, u16, u32, u32)> {
    let output = match Command::new("lsof")
        .args(["-iTCP", "-sTCP:ESTABLISHED", "-n", "-P"])
        .output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut conns = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 9 { continue; }

        let pid: u32 = match parts[1].parse() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let name = parts[parts.len() - 1];
        if !name.contains("->") { continue; }
        let mut sides = name.split("->");
        let src = sides.next().and_then(|s| s.rsplit(':').next())
            .and_then(|p| p.parse::<u16>().ok());
        let dst = sides.next().and_then(|s| s.rsplit(':').next())
            .and_then(|p| p.parse::<u16>().ok());
        if let (Some(s), Some(d)) = (src, dst) {
            // PID owns the src side; dst PID is unknown (0), will be matched via pid_to_port
            conns.push((s, d, pid, 0));
        }
    }
    conns
}

#[cfg(target_os = "linux")]
fn get_connections_linux() -> Vec<(u16, u16, u32, u32)> {
    let output = match Command::new("ss")
        .args(["-tnp", "state", "established"])
        .output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut conns = Vec::new();

    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 6 { continue; }
        let src = parts[3].rsplit(':').next()
            .and_then(|p| p.parse::<u16>().ok());
        let dst = parts[4].rsplit(':').next()
            .and_then(|p| p.parse::<u16>().ok());
        // Extract PID from the users column, e.g. users:(("node",pid=1234,fd=3))
        let pid: u32 = parts[5].split("pid=").nth(1)
            .and_then(|s| s.split(&[',', ')']).next())
            .and_then(|p| p.parse().ok())
            .unwrap_or(0);
        if let (Some(s), Some(d)) = (src, dst) {
            conns.push((s, d, pid, 0));
        }
    }
    conns
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn listening(port: u16, pid: u32) -> (u16, u32, String, Option<String>) {
        (port, pid, "node".to_string(), None)
    }

    #[test]
    fn conflicting_listeners_on_same_port_keep_distinct_nodes() {
        // Obscure ports keep live system connections out of the assertion.
        let graph = get_port_graph(&[listening(47111, 101), listening(47111, 202)]);

        let mut ids: Vec<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["port:47111:101", "port:47111:202"]);

        // Every edge references a real node id (no dangling port-only ids).
        let known: HashSet<&str> = ids.into_iter().collect();
        for edge in &graph.edges {
            assert!(known.contains(edge.source.as_str()), "dangling edge source {}", edge.source);
            assert!(known.contains(edge.target.as_str()), "dangling edge target {}", edge.target);
        }
    }

    #[test]
    fn single_listener_uses_endpoint_identity() {
        let graph = get_port_graph(&[listening(47222, 303)]);
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.nodes[0].id, "port:47222:303");
        assert_eq!(graph.nodes[0].port, 47222);
        assert_eq!(graph.nodes[0].pid, 303);
    }
}
