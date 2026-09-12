use serde::Serialize;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Poll interval of the tray watcher thread (see `tray.rs`).
/// Merged per-port traffic is bucketed to this resolution so samples from
/// independent per-endpoint ring buffers align by instant, not by index.
const TRAFFIC_BUCKET_MS: u64 = 2000;
/// Max merged samples returned per port (matches the per-endpoint ring cap).
const TRAFFIC_MAX_SAMPLES: usize = 30;

/// A single port event (started, stopped, etc.)
/// One scanned listener as the tray hands it to the logger:
/// `(port, pid, process name, project path, project name)`.
///
/// Named because the bare tuple appeared in three signatures across two
/// modules and tripped `clippy::type_complexity` in each.
pub type PortSnapshot = (u16, u32, String, Option<String>, Option<String>);

#[derive(Serialize, Clone, Debug)]
pub struct PortEvent {
    pub port: u16,
    pub pid: u32,
    pub process_name: String,
    pub framework: Option<String>,
    pub event_type: String, // "started" | "stopped" | "conflict"
    pub timestamp: u64,     // unix millis
}

/// Snapshot of traffic for a single port at a point in time
#[derive(Serialize, Clone, Debug)]
pub struct TrafficSample {
    pub connections: usize,
    pub timestamp: u64,
}

/// Per-port traffic history
#[derive(Clone, Debug)]
struct PortTraffic {
    samples: VecDeque<TrafficSample>,
}

impl PortTraffic {
    fn new() -> Self {
        Self {
            samples: VecDeque::new(),
        }
    }

    fn push(&mut self, conns: usize) {
        let ts = now_millis();
        self.samples.push_back(TrafficSample {
            connections: conns,
            timestamp: ts,
        });
        // Keep last 30 samples (~60 seconds at 2s interval)
        if self.samples.len() > 30 {
            // pop_front rotates a bounded queue in O(1); Vec::remove(0) shifts it.
            let _ = self.samples.pop_front();
        }
    }
}

/// Stable endpoint identity: ports are NOT unique (SO_REUSEADDR conflicts,
/// v4/v6 dual-binds, stale rows), matching the graph's `(port, pid)` NodeKey.
/// All tracking maps are keyed by endpoint so PID rotation emits lifecycle
/// events and conflicting listeners never collapse into one entry.
pub type EndpointKey = (u16, u32);

/// Global store for port events and traffic
pub struct PortLogger {
    events: Vec<PortEvent>,
    prev_ports: HashMap<EndpointKey, (String, Option<String>, Option<String>)>, // (port,pid) -> (process_name, framework, project_path)
    traffic: HashMap<EndpointKey, PortTraffic>,
    first_seen: HashMap<EndpointKey, u64>,
    /// Ports observed with >1 live PID on the last tick (for conflict edges).
    conflicts: std::collections::HashSet<u16>,
}

impl PortLogger {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            prev_ports: HashMap::new(),
            traffic: HashMap::new(),
            first_seen: HashMap::new(),
            conflicts: std::collections::HashSet::new(),
        }
    }

    /// Call this every scan cycle with the current port list and connection counts.
    /// Returns any new events generated.
    /// `conn_counts` is keyed by port (aggregated across conflicting PIDs).
    pub fn update(
        &mut self,
        ports: &[PortSnapshot],
        conn_counts: &HashMap<u16, usize>,
    ) -> Vec<PortEvent> {
        let ts = now_millis();
        let mut new_events = Vec::new();

        // Build current endpoint set keyed by (port, pid)
        let mut current: HashMap<EndpointKey, (String, Option<String>, Option<String>)> =
            HashMap::new();
        let mut port_to_endpoints: HashMap<u16, Vec<(String, Option<String>)>> = HashMap::new();
        for (port, pid, name, fw, project_path) in ports {
            current.insert(
                (*port, *pid),
                (name.clone(), fw.clone(), project_path.clone()),
            );
            port_to_endpoints
                .entry(*port)
                .or_default()
                .push((name.clone(), project_path.clone()));
        }

        // Detect new endpoints (started) — PID rotation on the same port is a
        // new endpoint, so it correctly emits `started` instead of going silent.
        for ((port, pid), (name, fw, _)) in &current {
            if !self.prev_ports.contains_key(&(*port, *pid)) {
                let event = PortEvent {
                    port: *port,
                    pid: *pid,
                    process_name: name.clone(),
                    framework: fw.clone(),
                    event_type: "started".into(),
                    timestamp: ts,
                };
                self.events.push(event.clone());
                new_events.push(event);
                self.first_seen.entry((*port, *pid)).or_insert(ts);
            }
        }

        // Detect removed endpoints (stopped)
        for ((port, pid), (name, _, _)) in &self.prev_ports {
            if !current.contains_key(&(*port, *pid)) {
                let event = PortEvent {
                    port: *port,
                    pid: *pid,
                    process_name: name.clone(),
                    framework: None,
                    event_type: "stopped".into(),
                    timestamp: ts,
                };
                self.events.push(event.clone());
                new_events.push(event);
            }
        }

        // Detect conflicts only when same-port listeners have different
        // process identities. Multiple PIDs with the same name and project
        // are a normal worker group.
        let mut new_conflicts = std::collections::HashSet::new();
        for (port, endpoints) in &port_to_endpoints {
            if endpoints.len() > 1 && endpoints.windows(2).any(|pair| pair[0] != pair[1]) {
                new_conflicts.insert(*port);
                if !self.conflicts.contains(port) {
                    // One conflict event per port (pid = lowest for stability)
                    let pid = current
                        .keys()
                        .filter(|(p, _)| p == port)
                        .map(|(_, pid)| *pid)
                        .min()
                        .unwrap_or(0);
                    let name = current
                        .get(&(*port, pid))
                        .map(|(n, _, _)| n.clone())
                        .unwrap_or_default();
                    let event = PortEvent {
                        port: *port,
                        pid,
                        process_name: name,
                        framework: None,
                        event_type: "conflict".into(),
                        timestamp: ts,
                    };
                    self.events.push(event.clone());
                    new_events.push(event);
                }
            }
        }
        self.conflicts = new_conflicts;

        // Update traffic samples per endpoint
        for key in current.keys() {
            // Per-endpoint share is unknown from aggregated counts; each live
            // endpoint records the port aggregate so retained history survives
            // worker turnover and no endpoint reports zero while the port is busy.
            // (Single-listener ports — the common case — are exact.)
            let conns = conn_counts.get(&key.0).copied().unwrap_or(0);
            self.traffic
                .entry(*key)
                .or_insert_with(PortTraffic::new)
                .push(conns);
        }

        // Purge state for stopped endpoints so long sessions cannot leak keys
        // and dead ports stop contributing to dashboard sums.
        let live: std::collections::HashSet<EndpointKey> = current.keys().copied().collect();
        self.traffic.retain(|key, _| live.contains(key));
        self.first_seen.retain(|key, _| live.contains(key));

        // Update prev_ports
        self.prev_ports = current;

        // Trim events to last 200
        if self.events.len() > 200 {
            self.events = self.events.split_off(self.events.len() - 200);
        }

        new_events
    }

    pub fn get_events(&self) -> Vec<PortEvent> {
        // Return in reverse chronological
        let mut events = self.events.clone();
        events.reverse();
        events
    }

    pub fn get_traffic(&self, port: u16) -> Vec<TrafficSample> {
        // Merge across conflicting PIDs by timestamp bucket, so the
        // IPC contract stays per-port while endpoints are tracked per
        // (port,pid). Index-based merging added unrelated moments: the
        // per-endpoint vectors are independent ring buffers that began
        // filling at different times and are trimmed independently.
        let endpoints: Vec<&PortTraffic> = self
            .traffic
            .iter()
            .filter(|((p, _), _)| *p == port)
            .map(|(_, t)| t)
            .collect();
        if endpoints.is_empty() {
            return Vec::new();
        }
        // Fast path: single listener needs no merge and stays exact.
        if endpoints.len() == 1 {
            return endpoints[0].samples.iter().cloned().collect();
        }
        // Multi-listener: one sample per bucket. Each endpoint collapses to
        // bucket -> connections first (last sample wins, samples are
        // chronological) so a fast-pushing endpoint cannot double-count
        // within a bucket. Each endpoint stores the same port-level aggregate,
        // so take the maximum across endpoints rather than counting that
        // aggregate once per listener.
        let mut merged: BTreeMap<u64, usize> = BTreeMap::new();
        for t in endpoints {
            let mut collapsed: BTreeMap<u64, usize> = BTreeMap::new();
            for s in &t.samples {
                let bucket = s.timestamp / TRAFFIC_BUCKET_MS * TRAFFIC_BUCKET_MS;
                collapsed.insert(bucket, s.connections);
            }
            for (bucket, conns) in collapsed {
                merged
                    .entry(bucket)
                    .and_modify(|current| *current = (*current).max(conns))
                    .or_insert(conns);
            }
        }
        // Keep the contract bounded like the per-endpoint rings.
        let skip = merged.len().saturating_sub(TRAFFIC_MAX_SAMPLES);
        merged
            .into_iter()
            .skip(skip)
            .map(|(timestamp, connections)| TrafficSample {
                connections,
                timestamp,
            })
            .collect()
    }

    pub fn get_all_traffic(&self) -> HashMap<u16, Vec<TrafficSample>> {
        // Aggregate per port; single-listener ports are exact.
        let mut out: HashMap<u16, Vec<TrafficSample>> = HashMap::new();
        let mut ports: Vec<u16> = self.traffic.keys().map(|(p, _)| *p).collect();
        ports.sort_unstable();
        ports.dedup();
        for port in ports {
            out.insert(port, self.get_traffic(port));
        }
        out
    }

    /// Test-only: production reads first-seen through the event stream, not
    /// this accessor. Kept because the retention tests assert on it directly.
    #[cfg(test)]
    pub fn get_first_seen(&self, port: u16) -> Option<u64> {
        // Earliest across live PIDs on this port (compat: frontend keys by port).
        self.first_seen
            .iter()
            .filter(|((p, _), _)| *p == port)
            .map(|(_, ts)| *ts)
            .min()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// Global singleton (std::sync::LazyLock — no extra dependency).
pub static LOGGER: LazyLock<Mutex<PortLogger>> = LazyLock::new(|| Mutex::new(PortLogger::new()));

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn mk_ports(ports: &[(u16, u32, &str)]) -> Vec<PortSnapshot> {
        ports
            .iter()
            .map(|(p, pid, name)| (*p, *pid, name.to_string(), None, None))
            .collect()
    }

    #[test]
    fn started_event_on_new_port() {
        let mut lg = PortLogger::new();
        let ports = mk_ports(&[(3000, 111, "node")]);
        let ev = lg.update(&ports, &HashMap::new());
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].port, 3000);
        assert_eq!(ev[0].event_type, "started");
        assert!(lg.get_first_seen(3000).is_some());
    }

    #[test]
    fn no_duplicate_started_on_same_ports() {
        let mut lg = PortLogger::new();
        let ports = mk_ports(&[(3000, 111, "node")]);
        lg.update(&ports, &HashMap::new());
        let ev2 = lg.update(&ports, &HashMap::new());
        assert_eq!(ev2.len(), 0);
    }

    #[test]
    fn stopped_event_on_removal() {
        let mut lg = PortLogger::new();
        lg.update(&mk_ports(&[(3000, 111, "node")]), &HashMap::new());
        let ev = lg.update(&[], &HashMap::new());
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].event_type, "stopped");
        assert_eq!(ev[0].port, 3000);
    }

    #[test]
    fn traffic_samples_capped_at_30() {
        let mut lg = PortLogger::new();
        for _ in 0..35 {
            lg.update(
                &mk_ports(&[(3000, 111, "node")]),
                &HashMap::from([(3000, 5)]),
            );
        }
        assert_eq!(lg.get_traffic(3000).len(), 30);
    }

    #[test]
    fn events_capped_at_200_and_reversed() {
        let mut lg = PortLogger::new();
        for i in 0..210 {
            lg.update(
                &mk_ports(&[(1000 + i as u16, i as u32, "x")]),
                &HashMap::new(),
            );
            // clear prev to force new started each time on a new port, but we need unique ports to avoid stopped
            // Instead simulate many distinct ports over time
        }
        // Manually push many events via distinct ports
        let mut lg2 = PortLogger::new();
        for i in 0..210 {
            let p = 3000 + (i % 50) as u16; // cycle to cause stopped/started
            lg2.update(&mk_ports(&[(p, i as u32, "x")]), &HashMap::new());
        }
        assert!(lg2.get_events().len() <= 200);
        // get_events reverses: most recent first
        let evs = lg2.get_events();
        if evs.len() >= 2 {
            assert!(evs[0].timestamp >= evs[1].timestamp);
        }
    }

    #[test]
    fn first_seen_not_overwritten() {
        let mut lg = PortLogger::new();
        lg.update(&mk_ports(&[(3000, 111, "a")]), &HashMap::new());
        let first = lg.get_first_seen(3000).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(5));
        lg.update(&mk_ports(&[(3000, 111, "a")]), &HashMap::new());
        assert_eq!(lg.get_first_seen(3000).unwrap(), first);
    }

    #[test]
    fn pid_rotation_emits_started() {
        let mut lg = PortLogger::new();
        lg.update(&mk_ports(&[(3000, 111, "node")]), &HashMap::new());
        // Same port, new PID (restart): must emit started, not go silent.
        let ev = lg.update(&mk_ports(&[(3000, 222, "node")]), &HashMap::new());
        assert!(ev.iter().any(|e| e.event_type == "started" && e.pid == 222));
        assert!(ev.iter().any(|e| e.event_type == "stopped" && e.pid == 111));
    }

    #[test]
    fn conflict_emits_conflict_event() {
        let mut lg = PortLogger::new();
        let ev = lg.update(
            &mk_ports(&[(3000, 111, "a"), (3000, 222, "b")]),
            &HashMap::new(),
        );
        assert!(ev
            .iter()
            .any(|e| e.event_type == "conflict" && e.port == 3000));
    }

    #[test]
    fn same_process_workers_do_not_emit_conflict_event() {
        let mut lg = PortLogger::new();
        let ev = lg.update(
            &mk_ports(&[(3000, 111, "node"), (3000, 222, "node")]),
            &HashMap::new(),
        );
        assert!(!ev.iter().any(|e| e.event_type == "conflict"));
    }

    #[test]
    fn same_process_name_in_different_projects_emits_conflict_event() {
        let mut lg = PortLogger::new();
        let ports = vec![
            (3000, 111, "node".into(), None, Some("/one".into())),
            (3000, 222, "node".into(), None, Some("/two".into())),
        ];
        let ev = lg.update(&ports, &HashMap::new());
        assert!(ev
            .iter()
            .any(|e| e.event_type == "conflict" && e.port == 3000));
    }

    #[test]
    fn stopped_endpoints_purge_traffic() {
        let mut lg = PortLogger::new();
        lg.update(
            &mk_ports(&[(3000, 111, "node")]),
            &HashMap::from([(3000, 5)]),
        );
        lg.update(&[], &HashMap::new());
        assert!(lg.get_all_traffic().is_empty());
        assert_eq!(lg.get_first_seen(3000), None);
    }

    #[test]
    fn get_all_traffic() {
        let mut lg = PortLogger::new();
        lg.update(
            &mk_ports(&[(3000, 1, "a"), (5173, 2, "b")]),
            &HashMap::from([(3000, 2), (5173, 5)]),
        );
        let all = lg.get_all_traffic();
        assert_eq!(all[&3000][0].connections, 2);
        assert_eq!(all[&5173][0].connections, 5);
    }

    #[test]
    fn multi_listener_traffic_reports_port_aggregate_once() {
        let mut lg = PortLogger::new();
        lg.update(
            &mk_ports(&[
                (3000, 101, "node"),
                (3000, 102, "node"),
                (3000, 103, "node"),
                (3000, 104, "node"),
            ]),
            &HashMap::from([(3000, 4)]),
        );

        let traffic = lg.get_traffic(3000);
        assert_eq!(traffic.len(), 1);
        assert_eq!(traffic[0].connections, 4);
    }

    fn inject_traffic(lg: &mut PortLogger, port: u16, pid: u32, samples: &[(usize, u64)]) {
        let entry = lg
            .traffic
            .entry((port, pid))
            .or_insert_with(PortTraffic::new);
        for (conns, ts) in samples {
            entry.samples.push_back(TrafficSample {
                connections: *conns,
                timestamp: *ts,
            });
        }
    }

    #[test]
    fn traffic_merge_aligns_by_bucket_not_index() {
        // Two endpoints whose ring buffers began at different times: the
        // late joiner must not shift alignment. Both store the same port
        // aggregate while they are live.
        let mut lg = PortLogger::new();
        let base: u64 = 1_000_000; // already aligned to TRAFFIC_BUCKET_MS
        inject_traffic(
            &mut lg,
            3000,
            111,
            &[(5, base), (7, base + 2000), (7, base + 4000)],
        );
        inject_traffic(
            &mut lg,
            3000,
            222,
            &[(7, base + 2000 + 100), (7, base + 4000 + 100)],
        );
        let merged = lg.get_traffic(3000);
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].timestamp, base);
        assert_eq!(merged[0].connections, 5);
        assert_eq!(merged[1].timestamp, base + 2000);
        assert_eq!(merged[1].connections, 7);
        assert_eq!(merged[2].timestamp, base + 4000);
        assert_eq!(merged[2].connections, 7);
    }

    #[test]
    fn traffic_merge_collapses_same_bucket_per_endpoint() {
        // Two pushes from one endpoint inside a single bucket count once
        // (last wins), not twice.
        let mut lg = PortLogger::new();
        let base: u64 = 2_000_000;
        inject_traffic(&mut lg, 3000, 111, &[(3, base + 10), (9, base + 20)]);
        inject_traffic(&mut lg, 3000, 222, &[(9, base + 30)]);
        let merged = lg.get_traffic(3000);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].timestamp, base);
        assert_eq!(merged[0].connections, 9);
    }

    #[test]
    fn traffic_merge_capped_at_30_buckets() {
        let mut lg = PortLogger::new();
        let base: u64 = 10_000_000;
        let a: Vec<(usize, u64)> = (0..35).map(|i| (1, base + i * 2000)).collect();
        let b: Vec<(usize, u64)> = (0..35).map(|i| (1, base + i * 2000)).collect();
        inject_traffic(&mut lg, 3000, 111, &a);
        inject_traffic(&mut lg, 3000, 222, &b);
        let merged = lg.get_traffic(3000);
        assert_eq!(merged.len(), 30);
        // Most-recent buckets survive the cap.
        assert_eq!(merged.last().unwrap().timestamp, base + 34 * 2000);
        assert_eq!(merged.last().unwrap().connections, 1);
    }
}
