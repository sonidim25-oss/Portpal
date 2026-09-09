<div align="center">

# ⚡ PortPal — Enhanced Edition

**Know what's running. Kill what's blocking. Safely.**

A hardened, production-grade native desktop dashboard for modern developers. Stop playing detective with `netstat` and `lsof`. PortPal watches your ports, tracks connection activity, and protects your critical services — so you can write code without fear of breaking your environment.

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/sonidim25-oss/Portpal/releases)
[![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/sonidim25-oss/Portpal)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/sonidim25-oss/Portpal/releases)
[![Built with Tauri 2](https://img.shields.io/badge/Built_with-Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)](https://react.dev)
[![Rust](https://img.shields.io/badge/Rust-CE422B?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)

**[View Original Project](https://github.com/wisher567/Portpal) • [Issues & Discussion](https://github.com/sonidim25-oss/Portpal)**

</div>

---

## 🤔 The Problem

Every developer knows the pain:

```text
Error: listen EADDRINUSE: address already in use :::3000
```

You open a project and *something* is already squatting on the port. Now you're hunting for PIDs and copy-pasting kill commands. Every. Single. Time.

PortPal — especially this enhanced fork — **ends that safely**.

---

## ✨ What's Different About This Fork?

This fork focuses on **production-grade reliability, security hardening, and architectural stability**. Since the original PortPal v0.2 release, this version has added:

### 🔒 Security & Safety Hardening

- **Protected Service Detection**: Prevents accidental termination of critical system services (PostgreSQL, Redis, MySQL, MongoDB, svchost, lsass, system)
- **Kill Confirmation with Blast Radius**: Shows exactly which ports and services will be terminated before you confirm
- **Protected Port Guards**: Default protection on ports 22 (SSH), 80/443 (HTTP/HTTPS), 3306 (MySQL), 5432 (PostgreSQL), 6379 (Redis), 27017 (MongoDB)
- **Environment-Configurable Protection**: Administrators can add custom critical ports via `PORTPAL_CRITICAL_PORTS` environment variable
- **Trusted Path Resolution**: External tools (`netstat`, `lsof`, `ss`) are resolved to trusted system paths only — no shell metacharacter injection
- **Single Source of Truth**: Port taxonomy and kill policy unified in `shared/taxonomy.json` with test coverage preventing drift between languages
- **Process Metadata Verification**: Re-scans current listeners before each kill to prevent PID reuse races

### 🏗️ Architectural Improvements

- **Unified Tauri Entrypoint**: Single `src-tauri/src/lib.rs` command registry (no more duplicate registration)
- **Async IPC Pipeline**: All blocking operations (`spawn_blocking` on async commands) prevent webview stalls
- **Robust Tool Failure Handling**: Scan failures return typed `ScanError` (not empty lists) so "nothing listening" ≠ "scan failed"
- **Taxonomy Parity Testing**: Rust and TypeScript taxonomies asserted against shared JSON fixture — missed edits fail tests
- **VecDeque Traffic History**: Efficient memory-bounded connection activity tracking with sparkline visualization

### 📈 UX & Reliability

- **STOPPED Port Rows**: Killed processes shown in-table with persistent restart button
- **Improved Search & Filters**: STOPPED rows included in search/filter results (not orphaned)
- **Traffic Sparklines**: Real-time connection activity with SVG visualization
- **Framework Detection**: Recognizes 18+ frameworks (React, Vite, Angular, Django, Node, Python, PHP, Jupyter, Tauri, and more)
- **Project Context**: Crawls for `package.json`, `Cargo.toml`, `go.mod` to identify running services
- **Event Logging**: Historical record of port conflicts, restarts, and process lifecycle

### 🐛 Stability & Bug Fixes

- **Zombie Process Prevention** (Unix): Proper child process reaping on restart
- **State Pruning**: Removes observation records for ports that no longer exist
- **Graceful Degradation**: Tool-missing errors surface retry affordances, not crashes
- **Netstat Localization Fix**: Robust structural parsing (never matches localized text like "LISTENING")
- **IPv6 & Zone IDs**: Handles complex addresses like `fe80::1%en0:8080`
- **PID Policy Enforcement**: PID 0 dropped (kernel), PID 1 visible but protected

---

## 🚀 Core Features

### 🔍 Real-Time Port Dashboard
See every listening TCP port on your machine at a glance — process name, PID, connections, framework detection, and project identification.

### ⚡ One-Click Control (Safe)
Hover over any port and click **✕** to kill it. A confirmation dialog shows:
- All processes being terminated
- Every port affected (not just filtered ones)
- Warning badges for critical services
- Keyboard-accessible cancel

Hit **↻** to restart it directly in a new terminal. Dead processes show a "stopped" badge with a persistent restart button.

### 📡 Intelligent Background Monitoring
PortPal lives quietly in your system tray:
- **Traffic light icon** alerts to conflicts and statuses
- **Hidden monitoring thread** builds a historical log while the window is closed
- **Automatic recovery detection** after scan tool failures
- **Port event timeline** tracks starts, stops, and conflicts

### 🧠 Smart Detection Engine
PortPal isn't just a basic `netstat` wrapper — it understands what you build:
- **18+ Framework Signatures** — React, Vite, Angular, Django, Node, Python, Jupyter, PHP, Ruby, Go, .NET, Java, and more
- **Project Crawling** — Finds `package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `pom.xml` to name your services
- **Default Port Mapping** — Recognizes standard dev ports (3000, 4200, 5173, 8000, 8080, etc.)

### 🛡️ Robust Scan Engine
- **Platform-Native Scanners**: Windows `netstat`, macOS/Linux `lsof`, Linux `ss` (with fallback)
- **TCP Scope Enforcement**: Only TCP listeners — UDP excluded due to connectionless nature
- **Detailed Scan Errors**: Distinguish "no services running" from "scan tool unavailable"
- **Graceful Degradation**: UI shows retry affordances when tools are missing or fail

---

## 📥 Installation

### Download Pre-Built

<table>
<tr>
<td align="center"><b>🪟 Windows</b></td>
<td align="center"><b>🍎 macOS</b></td>
<td align="center"><b>🐧 Linux</b></td>
</tr>
<tr>
<td align="center">
<a href="https://github.com/sonidim25-oss/Portpal/releases/latest"><code>.exe</code> setup (NSIS)</a><br/>
or <code>.exe</code> portable
</td>
<td align="center">
Build from source<br/>
(<code>bundle.targets</code> has no macOS installer)
</td>
<td align="center">
<a href="https://github.com/sonidim25-oss/Portpal/releases/latest"><code>.AppImage</code></a>
</td>
</tr>
</table>

### Build from Source

#### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Node.js** | ≥ 18 | [nodejs.org](https://nodejs.org) |
| **Rust** | ≥ 1.70 | [rustup.rs](https://rustup.rs) |
| **Tauri CLI** | v2 | Included |

#### Quick Start (Dev Environment)

```bash
# Clone
git clone https://github.com/sonidim25-oss/Portpal.git
cd portpal

# Install & Run
npm install
npm run tauri dev
```

> **Note:** `npm run tauri dev` launches with Vite HMR — edit React components and see changes instantly. The Rust backend and frontend are built together for full IPC support.

#### Production Build

```bash
# Windows: NSIS installer + portable exe
npx tauri build --bundles nsis

# Linux: AppImage portable
npx tauri build --bundles appimage

# macOS: requires building from source (no bundle.targets defined)
npm run build
cd src-tauri && cargo build --release
```

---

## 🎯 Supported Frameworks & Services

PortPal auto-detects these frameworks and services out-of-the-box:

| Port | Framework | Port | Service |
|------|-----------|------|---------|
| 3000 | React | 5432 | PostgreSQL |
| 3001 | React | 3306 | MySQL |
| 4000 | Node.js | 6379 | Redis |
| 4200 | Angular | 27017 | MongoDB |
| 5173 | Vite | 5984 | CouchDB |
| 5174 | Vite | 9000 | PHP |
| 8000 | Django | 9200 | Elasticsearch |
| 8080 | HTTP | 8888 | Jupyter |
| 8443 | HTTPS | 1420 | Tauri |

---

## 🏗️ Architecture

### Technology Stack

| Layer | Technology | Details |
|-------|-----------|---------|
| **Runtime** | Tauri 2 | Webview-based desktop app, Rust backend |
| **Frontend** | React 19 + TypeScript | Vite 7 build system |
| **Backend** | Rust | Process scanning, kill/restart, event logging |
| **Visualization** | Sparklines (SVG) | Real-time traffic display |
| **Styling** | Vanilla CSS | Glassmorphism UI design |
| **Scanner Engine** | Platform tools | `netstat` (Windows), `lsof` (macOS/Linux), `ss` (Linux) |
| **Logging** | LazyLock + thread-safe queue | Event storage and replay |

### Key Design Decisions

#### TCP Scope Only

PortPal lists **TCP listeners and connections only**. Every row is labelled `TCP` because:
- UDP is connectionless — no way to distinguish a service from a client socket
- Kill/Restart would operate on incomplete information
- The scope is stated rather than half-covered (see [docs/scan-scope.md](docs/scan-scope.md))

#### Process Restart Security

Restart uses backend-captured `program`, `args`, and working directory with **direct process execution**:
- `start_cmd` is **display-only** — never parsed or replayed through shell
- Arguments kept separate, including paths with spaces
- Shell metacharacters and batch/PowerShell launchers rejected
- Native server executable restarted, not a shell wrapper

#### Single-Source Kill Policy

Protected services and ports defined once in `shared/taxonomy.json`:
- Rust and TypeScript tables load and test against this fixture
- Missed edits fail CI (not silent security weakening)
- Custom critical ports added via `PORTPAL_CRITICAL_PORTS` env var (no remove)

---

## 🤝 Contributing

This fork welcomes contributions, especially:

- **Platform stability tests** (Windows, macOS, Linux edge cases)
- **New framework signatures** for more accurate project detection
- **UX hardening** around destructive actions
- **Documentation** of scan behavior and kill policy

### Development Workflow

1. **Fork** and create a feature branch: `git checkout -b feat/your-feature`
2. **Test locally**: `npm run tauri dev`
3. **Verify types**: `npx tsc --noEmit` (required for build pass)
4. **Run tests**: `npm run test:run && cd src-tauri && cargo test`
5. **Commit**: `git commit -m 'feat: description'`
6. **Push & open PR** against your fork

### Upstream Sync

This fork regularly syncs with the original PortPal project:

```bash
git fetch upstream
git merge upstream/main
npm install && npm run test:run
```

---

## 📚 Documentation

Detailed documentation in the `docs/` directory:

- **[docs/scan-scope.md](docs/scan-scope.md)** — Why TCP-only, address parsing, platform differences
- **[docs/kill-policy.md](docs/kill-policy.md)** — Process termination safety, confirmation UX, protected services
- **[docs/dev-security.md](docs/dev-security.md)** — External tool resolution, trusted paths, shell injection prevention
- **[docs/release-checklist.md](docs/release-checklist.md)** — Version bump, signing, distribution
- **[CLAUDE.md](CLAUDE.md)** — Developer guidance for Tauri, TypeScript, Rust conventions in this codebase

---

## 🧪 Testing

```bash
# Frontend unit & integration tests (Vitest)
npm run test:run

# Frontend with coverage
npm run test:cov

# End-to-end tests (Playwright)
npm run test:e2e

# Rust backend tests
cd src-tauri && cargo test

# Dependency audits
npm run audit
npm run audit:rust
```

> **Note:** A passing Vitest run does not guarantee a passing build. Vitest transpiles without typechecking — type errors show up only in `npm run build`. Always run `npx tsc --noEmit` before assuming frontend work is sound.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Credits

**Original Project**: [wisher567/Portpal](https://github.com/wisher567/Portpal)

**This Enhanced Fork**: Security hardening, architectural improvements, and stability fixes by sonidim25-oss.

**Built With**:
- 🦀 Rust + Tauri
- ⚛️ React + TypeScript
- 💜 Open-source community

---

<div align="center">

**If this version of PortPal saved you from one more `EADDRINUSE` accident, give it a ⭐**

Made with care for developers who value both speed and safety.

</div>
