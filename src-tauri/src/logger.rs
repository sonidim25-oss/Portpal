use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// A single port event (started, stopped, etc.)
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
    samples: Vec<TrafficSample>,
}

impl PortTraffic {
    fn new() -> Self {
        Self { samples: Vec::new() }
    }

    fn push(&mut self, conns: usize) {
        let ts = now_millis();
        self.samples.push(TrafficSample { connections: conns, timestamp: ts });
        // Keep last 30 samples (~60 seconds at 2s interval)
        if self.samples.len() > 30 {
            self.samples.remove(0);
        }
    }
}

/// Global store for port events and traffic
pub struct PortLogger {
    events: Vec<PortEvent>,
    prev_ports: HashMap<u16, (u32, String)>, // port -> (pid, process_name)
    traffic: HashMap<u16, PortTraffic>,
    first_seen: HashMap<u16, u64>,
}

impl PortLogger {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            prev_ports: HashMap::new(),
            traffic: HashMap::new(),
            first_seen: HashMap::new(),
        }
    }

    /// Call this every scan cycle with the current port list and connection counts.
    /// Returns any new events generated.
    pub fn update(
        &mut self,
        ports: &[(u16, u32, String, Option<String>)],
        conn_counts: &HashMap<u16, usize>,
    ) -> Vec<PortEvent> {
        let ts = now_millis();
        let mut new_events = Vec::new();

        // Build current port set
        let mut current: HashMap<u16, (u32, String, Option<String>)> = HashMap::new();
        for (port, pid, name, fw) in ports {
            current.insert(*port, (*pid, name.clone(), fw.clone()));
        }

        // Detect new ports (started)
        for (port, (pid, name, fw)) in &current {
            if !self.prev_ports.contains_key(port) {
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
                self.first_seen.entry(*port).or_insert(ts);
            }
        }

        // Detect removed ports (stopped)
        for (port, (pid, name)) in &self.prev_ports {
            if !current.contains_key(port) {
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

        // Update traffic samples
        for (port, _) in &current {
            let conns = conn_counts.get(port).copied().unwrap_or(0);
            self.traffic.entry(*port).or_insert_with(PortTraffic::new).push(conns);
        }

        // Update prev_ports
        self.prev_ports = current.iter()
            .map(|(port, (pid, name, _))| (*port, (*pid, name.clone())))
            .collect();

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
        self.traffic.get(&port)
            .map(|t| t.samples.clone())
            .unwrap_or_default()
    }

    pub fn get_all_traffic(&self) -> HashMap<u16, Vec<TrafficSample>> {
        self.traffic.iter()
            .map(|(port, t)| (*port, t.samples.clone()))
            .collect()
    }

    pub fn get_first_seen(&self, port: u16) -> Option<u64> {
        self.first_seen.get(&port).copied()
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// Global singleton
lazy_static::lazy_static! {
    pub static ref LOGGER: Mutex<PortLogger> = Mutex::new(PortLogger::new());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn mk_ports(ports: &[(u16, u32, &str)]) -> Vec<(u16, u32, String, Option<String>)> {
        ports.iter().map(|(p, pid, name)| (*p, *pid, name.to_string(), None)).collect()
    }

    #[test]
    fn started_event_on_new_port() {
        let mut lg = PortLogger::new();
        let ports = mk_ports(&[(3000, 111, "node")]);
        let ev = lg.update(&ports, &HashMap::new());
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].port, 3000);
        assert_eq!(ev[0].event_type, "started");
        assert_eq!(lg.get_first_seen(3000).is_some(), true);
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
            lg.update(&mk_ports(&[(3000, 111, "node")]), &HashMap::from([(3000, 5)]));
        }
        assert_eq!(lg.get_traffic(3000).len(), 30);
    }

    #[test]
    fn events_capped_at_200_and_reversed() {
        let mut lg = PortLogger::new();
        for i in 0..210 {
            lg.update(&mk_ports(&[(1000 + i as u16, i as u32, "x")]), &HashMap::new());
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
    fn get_all_traffic() {
        let mut lg = PortLogger::new();
        lg.update(&mk_ports(&[(3000, 1, "a"), (5173, 2, "b")]), &HashMap::from([(3000, 2), (5173, 5)]));
        let all = lg.get_all_traffic();
        assert_eq!(all[&3000][0].connections, 2);
        assert_eq!(all[&5173][0].connections, 5);
    }
}
