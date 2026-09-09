//! Shared socket-address parsing for the platform scan tools.
//!
//! `netstat`, `lsof` and `ss` all print an endpoint as host + port, but each
//! spells the host differently: IPv4 (`127.0.0.1:5173`), bracketed IPv6
//! (`[::]:1420`), unbracketed IPv6 (`:::8080`), a zone-scoped link-local
//! address (`fe80::1%en0:8080` or `[fe80::1%en0]:8080`), or a wildcard
//! (`*:3000`). `lsof` also appends a state token — `(LISTEN)`, `(ESTABLISHED)`
//! — which is usually its own whitespace token but can arrive glued to the
//! address.
//!
//! A naive `rsplit(':')` gets the common cases right and then silently misreads
//! an address that carries no port at all: `2001:db8::8080` would be reported
//! as a listener on port 8080, and `::1` as a listener on port 1. Every parse
//! site therefore goes through [`parse_socket_addr`], which accepts a trailing
//! `:port` only when the text to its left is a host it can actually recognise.
//!
//! Scope: PortPal lists TCP endpoints only (see `scanner::try_scan_ports`).
//! Address syntax is identical for UDP, so nothing here would need to change
//! if that scope were ever widened.

use std::net::Ipv6Addr;

/// Splits `text` into its host and port halves.
///
/// The host is returned exactly as it was written, minus the brackets of a
/// bracketed IPv6 literal: `*`, `0.0.0.0`, `::`, `fe80::1%en0`, or a hostname.
/// Returns `None` when `text` carries no port — including a bare IPv6 literal,
/// `*:*`, and anything whose port is not plain digits in `u16` range.
///
/// Port `0` is returned as written rather than rejected here; whether a
/// zero-port row is meaningful is the caller's policy, not the parser's.
pub fn parse_socket_addr(text: &str) -> Option<(&str, u16)> {
    let text = strip_state_token(text.trim());
    if text.is_empty() {
        return None;
    }

    // Brackets remove every ambiguity, so the port is simply whatever follows
    // `]:`. A bare `[::]` with nothing after it has no port and is rejected.
    if let Some(rest) = text.strip_prefix('[') {
        let (host, after) = rest.split_once(']')?;
        let port = after.strip_prefix(':')?;
        return Some((host, parse_port_number(port)?));
    }

    let (host, port) = text.rsplit_once(':')?;

    // Unbracketed text holding more than one colon is either an IPv6 literal
    // *with* a port (`:::8080`, `fe80::1%en0:8080`) or an IPv6 literal with no
    // port at all (`2001:db8::1`). The two are told apart by whether the text
    // left of the final colon is itself a complete address: `::` is, and
    // `2001:db8:` is not.
    if host.contains(':') && !is_ipv6_host(host) {
        return None;
    }

    Some((host, parse_port_number(port)?))
}

/// The port half of [`parse_socket_addr`], which is all the scanners need.
pub fn parse_port(text: &str) -> Option<u16> {
    parse_socket_addr(text).map(|(_, port)| port)
}

/// Drops a trailing `lsof` state token that was not separated by whitespace,
/// e.g. `*:3000(LISTEN)`. Whitespace-separated tokens are handled by the
/// callers that tokenize a whole line.
fn strip_state_token(text: &str) -> &str {
    let Some(stripped) = text.strip_suffix(')') else {
        return text;
    };
    match stripped.rfind('(') {
        // `(LISTEN)` alone is a state token, not an address.
        Some(0) => text,
        Some(open) => text[..open].trim_end(),
        None => text,
    }
}

/// Accepts only a plain decimal port. `u16::from_str` would also take `+80`
/// and other shapes no scan tool ever prints.
fn parse_port_number(port: &str) -> Option<u16> {
    if port.is_empty() || !port.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    port.parse().ok()
}

/// True when `host` is a complete IPv6 literal, ignoring any `%zone` suffix
/// (`%en0`, `%lo0`, `%12` on Windows), which is scope information rather than
/// part of the address.
fn is_ipv6_host(host: &str) -> bool {
    let base = host.split('%').next().unwrap_or(host);
    !base.is_empty() && base.parse::<Ipv6Addr>().is_ok()
}

// ─── netstat row parsing (Windows) ───────────────────────────────────────────

/// One `netstat -ano` TCP row, reduced to the three fields PortPal needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetstatTcpRow {
    pub local_port: u16,
    pub foreign_port: u16,
    pub pid: u32,
}

impl NetstatTcpRow {
    /// True when this row is a listening socket.
    ///
    /// A TCP listener has no peer, so `netstat` prints its Foreign Address as
    /// the null endpoint (`0.0.0.0:0`, or `[::]:0` for IPv6). Every other TCP
    /// state names a real peer on a non-zero port. That structural difference
    /// is what identifies a listener here, because the State column itself
    /// cannot be read — see [`parse_netstat_tcp_row`].
    pub fn is_listener(&self) -> bool {
        self.foreign_port == 0
    }
}

/// Parses one line of `netstat -ano` as a TCP row.
///
/// # Why the State column is never read
///
/// `netstat` translates its State column: `LISTENING` prints as `ABHÖREN` on
/// German Windows, `ESCUCHANDO` on Spanish, `À L'ÉCOUTE` on French. Matching
/// those words as text made PortPal report zero listening ports on every
/// non-English Windows install — and it failed silently, because the tool
/// still exited 0 with a full page of output, so no error path was ever
/// reached. Nothing here reads that column.
///
/// The Proto column *is* safe to match: protocol names are not translated.
///
/// # Why the PID is taken from the end of the row
///
/// A translated state can span several whitespace-separated tokens (French
/// `À L'ÉCOUTE` is two), which shifts every column after it. The PID is always
/// the last token on the row, so it is read from there rather than by a fixed
/// index.
///
/// Returns `None` for the banner, the header, UDP rows (which have no State
/// column at all), and anything else that does not parse as a TCP row.
pub fn parse_netstat_tcp_row(line: &str) -> Option<NetstatTcpRow> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    // Proto, Local Address, Foreign Address, State (one or more tokens), PID.
    if parts.len() < 5 || !parts[0].eq_ignore_ascii_case("TCP") {
        return None;
    }
    // A listener has no peer. Windows spells that Foreign Address `0.0.0.0:0`
    // or `[::]:0`, both of which parse to port 0; `*:*` carries the same
    // meaning and is accepted here so a listener is never dropped over
    // spelling, since a rejected row would silently vanish from the port list.
    let foreign_port = if parts[2] == "*:*" { 0 } else { parse_port(parts[2])? };
    Some(NetstatTcpRow {
        local_port: parse_port(parts[1])?,
        foreign_port,
        pid: parts[parts.len() - 1].parse().ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ipv4_and_wildcards() {
        assert_eq!(parse_socket_addr("0.0.0.0:3000"), Some(("0.0.0.0", 3000)));
        assert_eq!(parse_socket_addr("127.0.0.1:5173"), Some(("127.0.0.1", 5173)));
        assert_eq!(parse_socket_addr("10.0.0.5:49664"), Some(("10.0.0.5", 49664)));
        assert_eq!(parse_socket_addr("*:3000"), Some(("*", 3000)));
        assert_eq!(parse_socket_addr(":3000"), Some(("", 3000)));
    }

    #[test]
    fn parses_bracketed_ipv6() {
        assert_eq!(parse_socket_addr("[::]:1420"), Some(("::", 1420)));
        assert_eq!(parse_socket_addr("[::1]:5173"), Some(("::1", 5173)));
        assert_eq!(
            parse_socket_addr("[2001:db8::1]:8080"),
            Some(("2001:db8::1", 8080))
        );
    }

    #[test]
    fn parses_unbracketed_ipv6_that_really_carries_a_port() {
        // netstat/ss print the v6 wildcard this way.
        assert_eq!(parse_socket_addr(":::8080"), Some(("::", 8080)));
        assert_eq!(parse_socket_addr("::1:5173"), Some(("::1", 5173)));
    }

    #[test]
    fn parses_zone_scoped_link_local_addresses() {
        assert_eq!(parse_socket_addr("fe80::1%en0:8080"), Some(("fe80::1%en0", 8080)));
        assert_eq!(parse_socket_addr("[fe80::1%en0]:8080"), Some(("fe80::1%en0", 8080)));
        assert_eq!(parse_socket_addr("fe80::1%lo0:5173"), Some(("fe80::1%lo0", 5173)));
        // Windows numbers its zones.
        assert_eq!(parse_socket_addr("[fe80::c0a8:1%12]:445"), Some(("fe80::c0a8:1%12", 445)));
    }

    #[test]
    fn rejects_ipv6_literals_that_carry_no_port() {
        // The bug this parser exists for: `rsplit(':')` reported these as
        // listeners on ports 8080, 1 and 1 respectively.
        assert_eq!(parse_socket_addr("2001:db8::8080"), None);
        assert_eq!(parse_socket_addr("::1"), None);
        assert_eq!(parse_socket_addr("fe80::1%en0"), None);
        assert_eq!(parse_socket_addr("[::]"), None);
        assert_eq!(parse_socket_addr("[::1]"), None);
    }

    #[test]
    fn strips_glued_state_tokens() {
        assert_eq!(parse_socket_addr("*:3000(LISTEN)"), Some(("*", 3000)));
        assert_eq!(parse_socket_addr("[::1]:5173 (LISTEN)"), Some(("::1", 5173)));
        assert_eq!(parse_socket_addr("127.0.0.1:5173(ESTABLISHED)"), Some(("127.0.0.1", 5173)));
        // A state token on its own is not an address.
        assert_eq!(parse_socket_addr("(LISTEN)"), None);
    }

    #[test]
    fn accepts_hostname_forms_including_the_fqdn_trailing_dot() {
        assert_eq!(parse_socket_addr("localhost:3000"), Some(("localhost", 3000)));
        assert_eq!(parse_socket_addr("db.internal.:5432"), Some(("db.internal.", 5432)));
    }

    #[test]
    fn rejects_malformed_and_unnumbered_ports() {
        assert_eq!(parse_socket_addr("invalid"), None);
        assert_eq!(parse_socket_addr("0.0.0.0:abc"), None);
        assert_eq!(parse_socket_addr("*:*"), None);
        assert_eq!(parse_socket_addr("0.0.0.0:"), None);
        assert_eq!(parse_socket_addr("0.0.0.0:+80"), None);
        assert_eq!(parse_socket_addr("0.0.0.0:65536"), None);
        assert_eq!(parse_socket_addr(""), None);
        assert_eq!(parse_socket_addr("   "), None);
    }

    #[test]
    fn parse_port_matches_the_full_parse() {
        assert_eq!(parse_port("[fe80::1%en0]:8080"), Some(8080));
        assert_eq!(parse_port("0.0.0.0:0"), Some(0));
        assert_eq!(parse_port("2001:db8::1"), None);
    }

    // ─── netstat row parsing ─────────────────────────────────────────────

    // Real `netstat -ano` rows. Column widths vary by locale, so every test
    // goes through split_whitespace rather than fixed offsets.
    const EN_LISTEN: &str = "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1052";
    const EN_ESTAB: &str = "  TCP    192.168.1.5:52341      142.250.185.78:443     ESTABLISHED     6789";

    #[test]
    fn parses_english_listening_and_established_rows() {
        let listen = parse_netstat_tcp_row(EN_LISTEN).expect("listening row");
        assert_eq!(listen, NetstatTcpRow { local_port: 135, foreign_port: 0, pid: 1052 });
        assert!(listen.is_listener());

        let estab = parse_netstat_tcp_row(EN_ESTAB).expect("established row");
        assert_eq!(estab, NetstatTcpRow { local_port: 52341, foreign_port: 443, pid: 6789 });
        assert!(!estab.is_listener());
    }

    #[test]
    fn listener_detection_survives_a_translated_state_column() {
        // The bug this parser exists for: matching the literal word LISTENING
        // reported zero listening ports on every non-English Windows install.
        for row in [
            "  TCP    0.0.0.0:135            0.0.0.0:0              ABHÖREN         1052",
            "  TCP    0.0.0.0:135            0.0.0.0:0              ESCUCHANDO      1052",
            "  TCP    0.0.0.0:135            0.0.0.0:0              IN ATTESA       1052",
            "  TCP    0.0.0.0:135            0.0.0.0:0              À L'ÉCOUTE      1052",
        ] {
            let parsed = parse_netstat_tcp_row(row).expect(row);
            assert!(parsed.is_listener(), "{row}");
            assert_eq!(parsed.local_port, 135, "{row}");
            // The PID must survive a state that spans several tokens, which is
            // what shifts it off the fixed index the old parser assumed.
            assert_eq!(parsed.pid, 1052, "{row}");
        }
    }

    #[test]
    fn connection_detection_survives_a_translated_state_column() {
        for row in [
            "  TCP    192.168.1.5:52341      142.250.185.78:443     HERGESTELLT     6789",
            "  TCP    192.168.1.5:52341      142.250.185.78:443     ESTABLECIDO     6789",
            "  TCP    192.168.1.5:52341      142.250.185.78:443     ÉTABLI          6789",
        ] {
            let parsed = parse_netstat_tcp_row(row).expect(row);
            assert!(!parsed.is_listener(), "{row}");
            assert_eq!(parsed.foreign_port, 443, "{row}");
            assert_eq!(parsed.pid, 6789, "{row}");
        }
    }

    #[test]
    fn parses_ipv6_rows_in_both_roles() {
        let listen = parse_netstat_tcp_row("  TCP    [::]:445               [::]:0                 LISTENING       4")
            .expect("v6 listener");
        assert_eq!(listen, NetstatTcpRow { local_port: 445, foreign_port: 0, pid: 4 });
        assert!(listen.is_listener());

        let estab = parse_netstat_tcp_row("  TCP    [fe80::1%12]:52350     [2606:4700::1111]:443  ESTABLISHED     900")
            .expect("v6 connection");
        assert_eq!(estab, NetstatTcpRow { local_port: 52350, foreign_port: 443, pid: 900 });
        assert!(!estab.is_listener());
    }

    #[test]
    fn rejects_rows_that_are_not_tcp() {
        // UDP has no State column at all, so it is both too short and the
        // wrong protocol. Protocol names are not translated, so matching the
        // Proto column stays safe in every locale.
        assert_eq!(parse_netstat_tcp_row("  UDP    0.0.0.0:5353           *:*                                    2345"), None);
        assert_eq!(parse_netstat_tcp_row("  Proto  Local Address          Foreign Address        State           PID"), None);
        assert_eq!(parse_netstat_tcp_row("Active Connections"), None);
        assert_eq!(parse_netstat_tcp_row("Aktive Verbindungen"), None);
        assert_eq!(parse_netstat_tcp_row(""), None);
        assert_eq!(parse_netstat_tcp_row("   "), None);
    }

    #[test]
    fn treats_a_wildcard_foreign_address_as_no_peer() {
        let row = parse_netstat_tcp_row("  TCP    0.0.0.0:135            *:*                    LISTENING       1052")
            .expect("wildcard foreign address");
        assert_eq!(row, NetstatTcpRow { local_port: 135, foreign_port: 0, pid: 1052 });
        assert!(row.is_listener());
    }

    #[test]
    fn rejects_a_tcp_row_whose_pid_is_not_a_number() {
        assert_eq!(
            parse_netstat_tcp_row("  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       nope"),
            None
        );
    }

    #[test]
    fn a_time_wait_row_parses_and_keeps_its_zero_pid() {
        // Windows leaves TIME_WAIT sockets unattributed. The row still parses;
        // dropping PID 0 is the caller's policy (see scanner::is_unattributed_pid).
        let row = parse_netstat_tcp_row("  TCP    192.168.1.5:52355      142.250.185.78:443     TIME_WAIT       0")
            .expect("time_wait row");
        assert_eq!(row.pid, 0);
        assert!(!row.is_listener());
    }

}
