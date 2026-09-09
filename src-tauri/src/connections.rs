// `parse_port` serves the macOS and Linux connection parsers; the Windows
// one parses whole rows through `parse_netstat_tcp_row`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::netaddr::parse_port;
#[cfg(target_os = "windows")]
use crate::netaddr::parse_netstat_tcp_row;
use crate::scanner::is_unattributed_pid;
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

pub fn is_dev_port(port: u16) -> bool {
    DEV_PORTS.iter().any(|(p, _)| *p == port)
}

/// Backend dev-port set for tray/liveness surfaces, so icon, tooltip, and
/// graph liveness derive from the same table instead of three copies.
pub fn dev_ports() -> &'static [(u16, &'static str)] {
    DEV_PORTS
}

/// Stable endpoint identity: ports are NOT unique (SO_REUSEADDR conflicts,
/// v4/v6 dual-binds, stale rows), so nodes are keyed by (port, pid) and ids
/// use the format `port:{port}:{pid}`. The legacy `port:{port}` format dropped
/// conflicting listeners sharing a port.
type NodeKey = (u16, u32);

fn node_id(port: u16, pid: u32) -> String {
    format!("port:{}:{}", port, pid)
}

/// One observed live TCP connection.
///
/// "Live" rather than strictly ESTABLISHED: the Windows parser selects
/// rows structurally, because the State column it would otherwise match is
/// translated on non-English installs. macOS and Linux still select
/// ESTABLISHED exactly, via `lsof -sTCP:ESTABLISHED` and `ss state
/// established`, which take the state as an argument rather than as output.
///
/// `src_pid`/`dst_pid` are `None` when the platform tool did not attribute
/// that side of the connection to a process — `lsof` never names the remote
/// peer, and `ss` omits the owner for sockets the current user cannot see.
/// Both used to arrive as a literal `0`, the same value the tools print for a
/// socket owned by no user process (see `scanner::is_unattributed_pid`), which
/// let an unattributed peer match a phantom `(port, 0)` node in `pid_to_keys`
/// and draw an edge to a process that does not exist.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Connection {
    src_port: u16,
    dst_port: u16,
    src_pid: Option<u32>,
    dst_pid: Option<u32>,
}

/// Normalizes a PID reported by a scan tool: PID 0 carries no identity, so it
/// becomes "unattributed" rather than a matchable process. PID 1 is a real
/// process that can own a listed listener, so it is matched like any other —
/// being protected from kills is a separate question from being real.
fn attributed_pid(pid: u32) -> Option<u32> {
    (!is_unattributed_pid(pid)).then_some(pid)
}

pub fn get_port_graph(
    listening: &[(u16, u32, String, Option<String>)],
) -> PortGraph {
    build_graph(listening, &get_active_connections())
}

/// The pure half of [`get_port_graph`]: no OS calls, so the edge rules are
/// testable against fabricated connection rows.
fn build_graph(
    listening: &[(u16, u32, String, Option<String>)],
    connections: &[Connection],
) -> PortGraph {
    // listening: (port, pid, process_name, project_name)

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

    for conn in connections {
        let Connection { src_port, dst_port, src_pid, dst_pid } = conn;
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
            // dst_port is a server; src_pid might own another listening port.
            // An unattributed side (`None`) matches nothing at all.
            if let Some(src_keys) = src_pid.and_then(|pid| pid_to_keys.get(&pid)) {
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
            // src_port is a server; dst_pid might own another listening port.
            if let Some(dst_keys) = dst_pid.and_then(|pid| pid_to_keys.get(&pid)) {
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

/// Lists established TCP connections.
///
/// TCP only, matching `scanner::try_scan_ports`: the graph draws edges between
/// listeners, and UDP has neither a listening state nor a connection to
/// observe. A UDP flow would have no ESTABLISHED row to read on any of the
/// three platforms. See `docs/scan-scope.md`.
fn get_active_connections() -> Vec<Connection> {
    #[cfg(target_os = "windows")]
    return get_connections_windows();

    #[cfg(target_os = "macos")]
    return get_connections_macos();

    #[cfg(target_os = "linux")]
    return get_connections_linux();
}

#[cfg(target_os = "windows")]
fn get_connections_windows() -> Vec<Connection> {
    // Use netstat -ano to get all ESTABLISHED connections with PIDs
    let output = match Command::new("netstat").args(["-ano"]).output() {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);

    // First pass: collect every TCP row that names a real peer.
    // netstat format: Proto  Local Address  Foreign Address  State  PID
    let mut raw_conns: Vec<(u16, u16, u32)> = Vec::new();

    for line in stdout.lines() {
        let Some(row) = parse_netstat_tcp_row(line) else { continue };
        // Selecting by the literal word ESTABLISHED found nothing on a
        // non-English Windows, where the State column is translated. That
        // column is no longer read: a row with a non-null Foreign Address has
        // a real peer. This does admit the other live states (CLOSE_WAIT,
        // SYN_SENT, FIN_WAIT) alongside ESTABLISHED, which is a slight
        // widening. TIME_WAIT, much the most common of them, drops out just
        // below because Windows leaves those sockets unattributed (PID 0).
        if row.is_listener() { continue; }
        // A reserved PID owns no identity we can match a node against.
        let Some(pid) = attributed_pid(row.pid) else { continue };
        raw_conns.push((row.local_port, row.foreign_port, pid));
    }

    // Build a port→pid lookup from all connections so we can find the PID for each side
    let mut port_pid: HashMap<u16, u32> = HashMap::new();
    for (s, _d, pid) in &raw_conns {
        port_pid.insert(*s, *pid);
        // For the destination, we may find its PID from another connection where it's the source
    }

    // Now pair connections: for each (src, dst, pid), find the dst's PID. A
    // miss means the peer is outside this machine (or outside what netstat
    // attributed), which stays `None` rather than collapsing to PID 0.
    let mut conns: Vec<Connection> = Vec::new();
    for (s, d, src_pid) in &raw_conns {
        conns.push(Connection {
            src_port: *s,
            dst_port: *d,
            src_pid: Some(*src_pid),
            dst_pid: port_pid.get(d).copied(),
        });
    }

    conns
}

#[cfg(target_os = "macos")]
fn get_connections_macos() -> Vec<Connection> {
    // `-iTCP -sTCP:ESTABLISHED` keeps this TCP-only by construction.
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
        let src = sides.next().and_then(parse_port);
        let dst = sides.next().and_then(parse_port);
        if let (Some(s), Some(d)) = (src, dst) {
            // This row attributes the local side only; lsof never names the
            // remote peer's process, so that side is genuinely unknown.
            conns.push(Connection {
                src_port: s,
                dst_port: d,
                src_pid: attributed_pid(pid),
                dst_pid: None,
            });
        }
    }
    conns
}

#[cfg(target_os = "linux")]
fn get_connections_linux() -> Vec<Connection> {
    // `-t` keeps this TCP-only; `ss -u` would list UDP sockets that have no
    // established state to report.
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
        let src = parse_port(parts[3]);
        let dst = parse_port(parts[4]);
        // Extract PID from the users column, e.g. users:(("node",pid=1234,fd=3)).
        // `ss` omits it for sockets this user cannot attribute, which stays
        // unknown instead of becoming PID 0.
        let pid: Option<u32> = parts[5].split("pid=").nth(1)
            .and_then(|s| s.split(&[',', ')'][..]).next())
            .and_then(|p| p.parse().ok())
            .and_then(attributed_pid);
        if let (Some(s), Some(d)) = (src, dst) {
            // `ss` reports the local owner only; the peer is unattributed.
            conns.push(Connection { src_port: s, dst_port: d, src_pid: pid, dst_pid: None });
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

    fn conn(src_port: u16, dst_port: u16, src_pid: Option<u32>, dst_pid: Option<u32>) -> Connection {
        Connection { src_port, dst_port, src_pid, dst_pid }
    }

    // ─── Unknown peer vs. PID 0 ──────────────────────────────────────────

    #[test]
    fn unattributed_peer_never_creates_or_matches_a_node() {
        // lsof/ss report only the local owner. The peer used to arrive as a
        // literal 0, which matched any listener the caller happened to key at
        // PID 0 and drew an edge to a process that does not exist.
        let listening = [listening(47411, 0), listening(47412, 707)];
        let graph = build_graph(
            &listening,
            &[conn(47412, 61000, Some(707), None), conn(61001, 47412, None, None)],
        );

        // The connections attribute no peer, so no edge can be inferred.
        assert!(graph.edges.is_empty(), "unexpected edges: {:?}", graph.edges);
        // And the unknown peer neither created a node nor touched the PID 0 row.
        let mut ids: Vec<&str> = graph.nodes.iter().map(|n| n.id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, vec!["port:47411:0", "port:47412:707"]);
        assert!(graph.nodes.iter().all(|n| n.connection_count == 0));
    }

    #[test]
    fn attributed_peer_on_the_same_machine_still_links() {
        // The happy path the typed peer must not regress: a real PID on an
        // ephemeral source port still links to the listener it owns.
        let graph = build_graph(
            &[listening(47421, 808), listening(47422, 909)],
            &[conn(61002, 47422, Some(808), None)],
        );

        assert_eq!(graph.edges.len(), 1);
        let edge = &graph.edges[0];
        let ends = [edge.source.as_str(), edge.target.as_str()];
        assert!(ends.contains(&"port:47421:808"), "{ends:?}");
        assert!(ends.contains(&"port:47422:909"), "{ends:?}");
    }

    #[test]
    fn only_pid_zero_is_never_attributed() {
        assert_eq!(attributed_pid(0), None);
        // PID 1 owns real sockets (systemd socket activation) and is listed,
        // so a connection it owns must still match its listener.
        assert_eq!(attributed_pid(1), Some(1));
        assert_eq!(attributed_pid(2), Some(2));
        assert_eq!(attributed_pid(31337), Some(31337));
    }

    #[test]
    fn a_pid_one_listener_still_gets_its_edges() {
        // Visible-but-protected: a socket-activated listener is a normal node
        // as far as the graph is concerned.
        let graph = build_graph(
            &[listening(47431, 1), listening(47432, 606)],
            &[conn(61003, 47432, Some(1), None)],
        );

        assert_eq!(graph.edges.len(), 1);
        let edge = &graph.edges[0];
        let ends = [edge.source.as_str(), edge.target.as_str()];
        assert!(ends.contains(&"port:47431:1"), "{ends:?}");
        assert!(ends.contains(&"port:47432:606"), "{ends:?}");
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
