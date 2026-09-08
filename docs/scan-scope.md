# Scan scope: what PortPal lists, and what it deliberately does not

## TCP only, on every platform

Every row PortPal shows is a **TCP listener**, and every edge on the port map is
an **established TCP connection**. `PortInfo.protocol` is therefore always
`"TCP"`; the column states that rather than leaving the protocol implicit.

This is enforced by the scan selectors themselves, not by a filter applied
afterwards:

| Platform | Listeners | Connections |
|----------|-----------|-------------|
| Windows | `netstat -ano`, rows in the `LISTENING` state | `netstat -ano`, rows in the `ESTABLISHED` state |
| macOS | `lsof -iTCP -sTCP:LISTEN -n -P` | `lsof -iTCP -sTCP:ESTABLISHED -n -P` |
| Linux | `lsof -iTCP -sTCP:LISTEN -n -P` | `ss -tnp state established` |

`LISTENING` and `ESTABLISHED` are TCP connection states, so a UDP row cannot
match them even where the tool prints one.

## Why UDP is out of scope rather than pending

UDP is connectionless. A UDP socket has no `LISTEN` state and no established
connection, so nothing in the output distinguishes a socket that *serves*
requests from one a client opened purely to send a datagram, and there is no
peer to draw an edge to. `netstat -ano` and `lsof -iUDP` would list both kinds
identically.

That matters because PortPal treats a row as an owned service: it offers Kill
and Restart, attributes it to a project, and counts it as a port conflict. UDP
rows would carry the same affordances on top of a fact the scan cannot
establish — plausible-looking entries the rest of the app cannot reason about,
including "conflicts" for client sockets that will be gone a second later.

Half-covering UDP would be worse than not covering it, so the scan states its
scope instead:

- the protocol column shows `TCP` on every row;
- the Protocol filter marks UDP as not scanned, so an empty result reads as
  "PortPal does not look at UDP" rather than "you have no UDP services";
- `scanner::try_scan_ports` and `connections::get_active_connections` carry the
  same note at the code entry points.

Adding UDP later means answering the "is this a service?" question first —
likely by treating a bound UDP socket as a service only when its owning process
also holds a TCP listener, or by an explicit opt-in view labelled as bound
sockets rather than as listeners.

## Address parsing (`src-tauri/src/netaddr.rs`)

All three tools print an endpoint as host + port, but each spells the host
differently. One shared parser, `netaddr::parse_socket_addr`, handles every
form; the scanners and the connection parsers have no address logic of their
own.

Accepted:

| Form | Example | Port |
|------|---------|------|
| IPv4 | `127.0.0.1:5173` | 5173 |
| Wildcard | `*:3000`, `:3000` | 3000 |
| Bracketed IPv6 | `[::]:1420`, `[::1]:5173` | 1420, 5173 |
| Unbracketed IPv6 wildcard | `:::8080` | 8080 |
| Zone-scoped link-local | `fe80::1%en0:8080`, `[fe80::c0a8:1%12]:445` | 8080, 445 |
| Hostname, incl. FQDN trailing dot | `db.internal.:5432` | 5432 |
| Glued lsof state token | `*:3000(LISTEN)` | 3000 |

Rejected (no port present, or not a port):

`2001:db8::8080`, `::1`, `fe80::1%en0`, `[::]`, `*:*`, `0.0.0.0:abc`,
`0.0.0.0:+80`, `0.0.0.0:65536`.

The rejections are the point of the parser. The previous `rsplit(':')` at each
call site read the text after the last colon and so reported a bare IPv6
literal as a listener — `2001:db8::8080` as port 8080, `::1` as port 1. An
unbracketed address is now accepted only when the text left of the final colon
is itself a complete IPv6 literal (`::` is; `2001:db8:` is not), which
separates "address with a port" from "address without one". A `%zone` suffix is
scope information and is ignored for that check while being preserved in the
returned host.

## PID policy

Two different questions, two different rules:

| Rule | Predicate | Means |
|------|-----------|-------|
| What may be **shown** | `scanner::is_unattributed_pid` — PID 0 only | The row names no process, so it cannot be attributed, matched, or acted on |
| What may be **acted on** | `scanner::is_reserved_pid` — PID 0 and PID 1 | `validate_kill`/`kill_pid` refuse to signal it |

**PID 0 is not a process.** It is the placeholder a tool prints for a socket it
could not attribute to a user process (System Idle on Windows, the swapper on
Unix). Both platform scanners skip it, and `connections` never matches it.

**PID 1 listeners are listed.** A `systemd` socket-activated listener is
genuinely bound and genuinely occupies the port even though PID 1 owns it, so
hiding it would make a real conflict silently vanish from the UI — the opposite
of what PortPal is for. Those rows are *visible but protected*, the same
pattern as a critical service: the kill guards reject `pid <= 1` before
signalling anything, and restart requires a trusted launch record that PID 1
never has. Protection lives at the point of action, not in the listing.

PID 0 has a second, unrelated meaning in the raw output of `lsof` and `ss`:
*peer not attributed*. `lsof` never names the remote process, and `ss` omits the
owner for sockets the current user cannot see. Collapsing that to a literal `0`
conflated "no process" with "a socket owned by no user process", and let an
unattributed peer match a phantom `(port, 0)` node when the graph looked up
`pid_to_keys`.

`connections::Connection` therefore types both sides as `Option<u32>`:

```rust
struct Connection {
    src_port: u16,
    dst_port: u16,
    src_pid: Option<u32>,   // None = this side was not attributed
    dst_pid: Option<u32>,
}
```

`None` matches nothing, so an unknown peer can neither create a node nor gain
an edge. `connections::attributed_pid` maps PID 0 to `None` at every parse
site, so the two meanings can never be mixed again. PID 1 passes through it
unchanged: a connection owned by a socket-activated service still links to that
service's listed node.

## Tests

- `netaddr::tests` — the full address matrix above, including every rejection.
- `scanner::tests::parse_netstat_port_ipv6_edge_cases`,
  `parse_lsof_name_ipv6_edge_cases` — the same forms through the call-site
  wrappers, including a glued `(LISTEN)` token and a portless NAME column.
- `scanner::tests::reserved_pids_are_zero_and_one_everywhere`,
  `kill_rejects_reserved_pids_before_anything_else` — one kill policy, shared
  by both guards.
- `scanner::tests::only_pid_zero_is_unlistable`,
  `a_pid_one_listener_is_listed_but_not_killable` — the listing rule is the
  narrower one, and the kill guard is what refuses a PID 1 row.
- `connections::tests::unattributed_peer_never_creates_or_matches_a_node` — an
  unknown peer produces no edge and leaves a PID 0 row untouched;
  `attributed_peer_on_the_same_machine_still_links` and
  `a_pid_one_listener_still_gets_its_edges` pin the happy paths;
  `only_pid_zero_is_never_attributed` pins the sentinel rule.
