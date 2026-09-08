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
}
