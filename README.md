<div align="center">

![PortPal — Developer Port Manager](https://raw.githubusercontent.com/wisher567/Portpal/main/assets/hero.png)

# ⚡ PortPal

**Know what's running. Kill what's blocking.**

A blazing-fast, native desktop dashboard built for modern developers. Stop playing detective with `netstat` and `lsof`. PortPal watches your ports and tracks connection activity — so you can just write code.

[![Windows](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/wisher567/Portpal/releases)
[![macOS](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/wisher567/Portpal/releases)
[![Linux](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/wisher567/Portpal/releases)
[![Built with Tauri](https://img.shields.io/badge/Built_with-Tauri_2-FFC131?style=for-the-badge&logo=tauri&logoColor=white)](https://tauri.app)
[![Stars](https://img.shields.io/github/stars/wisher567/Portpal?style=social)](https://github.com/wisher567/Portpal)

![PortPal App Interaction Demo](https://raw.githubusercontent.com/wisher567/Portpal/main/assets/gif.gif)

</div>

---

## 🤔 The Problem

Every developer knows the pain:

```text
Error: listen EADDRINUSE: address already in use :::3000
```

You open a project and *something* is already squatting on the port. Now you're hunting for PIDs and copy-pasting kill commands. Every. Single. Time.

**PortPal ends that.**

---

## ✨ What's New in v0.2? (The Dashboard Era)

We've evolved from a simple port list to a full **Developer Command Center**:

- 📈 **Traffic Sparklines:** Watch real-time connection activity with beautiful, animated SVG mini-charts natively embedded in your metrics.
- 📋 **Historical Event Logging:** A dedicated logs page tracks every process start, stop, and port conflict along with timestamps and framework contexts.
- 📦 **Categorized Services:** PortPal automatically groups active ports into cleanly contained UI cards by project and framework.
- 🗂️ **Dev vs. System Isolation:** Quickly filter ports by 'Dev Frameworks' or 'Other System Apps', complete with a *Kill All* panic button.
- 🎨 **Windowless Chrome:** Frameless application design with integrated native UI controls for a hyper-modern feel.

---

## 🚀 Core Features

### 🔍 Real-Time Port Dashboard
See every listening port on your machine at a glance — process name, PID, connections, framework detection, and project identification. 

### ⚡ One-Click Control
Hover over any port and click **✕** to kill it instantly. If PortPal knows the start command, hit **↻** to restart it directly in a new terminal. Dead processes show a "stopped" badge with a persistent restart button.

### 🗺️ Interactive Port Map (D3.js Topology) — temporarily disabled in v0.2

> **Note:** The Port Map route is disabled in v0.2 builds (hidden from navigation in `src/App.tsx` / `src/components/shell/Sidebar.tsx`; code preserved in `src/features/port-map/`). What follows describes the planned feature, not what ships today.

The crown jewel of PortPal. A D3.js-powered network topology visualization that shows precisely how your services are communicating.

<div align="center">
![Port Map — Interactive Network Topology](https://raw.githubusercontent.com/wisher567/Portpal/main/assets/portmap.png)
</div>

- **Drag & Collide** simulation for physical manipulation
- **Scroll** to zoom in and navigate
- **Node Caching & Real-time updates** without screen flickering
- **Framework-colored nodes** and connection metrics

### 🔔 System Tray Intelligence
PortPal lives quietly in your system tray:
- **Traffic light icon** immediately alerts you to conflicts and statuses
- A background thread quietly builds a historical log of all backend activity while the window is closed

### 🧠 Smart Detection Engine
PortPal isn't just a basic `netstat` wrapper — it understands what you build:
- **Framework Detection** — Recognizes React, Vite, Angular, Django, Node, and more via default ports.
- **Project Context** — Crawls for `package.json`, `Cargo.toml`, or `go.mod` to name your running servers.

### 📡 Scope: TCP listeners
PortPal lists **TCP listeners only**, on every platform — that is why every row
is labelled `TCP` and the Protocol filter marks UDP as not scanned. UDP is
connectionless, so nothing in `netstat`/`lsof` output separates a socket that
serves requests from one a client opened to send a datagram, and Kill/Restart
would be offered on a guess. The scope is stated rather than half-covered; see
[docs/scan-scope.md](docs/scan-scope.md) for the reasoning, the IPv6 address
forms the scanner handles (including zone IDs such as `fe80::1%en0:8080`), and
the PID policy (PID 0 rows are dropped; a systemd-owned PID 1 listener stays
visible but protected).

---

## 📥 Installation

### Download

<table>
<tr>
<td align="center"><b>🪟 Windows</b></td>
<td align="center"><b>🍎 macOS</b></td>
<td align="center"><b>🐧 Linux</b></td>
</tr>
<tr>
<td align="center">
<a href="https://github.com/wisher567/Portpal/releases/latest"><code>.exe</code> setup (NSIS)</a>
</td>
<td align="center">
Build from source (no installer is produced — <code>bundle.targets</code> has no macOS target)
</td>
<td align="center">
<a href="https://github.com/wisher567/Portpal/releases/latest"><code>.AppImage</code></a>
</td>
</tr>
</table>

> **Note:** `src-tauri/tauri.conf.json` builds `bundle.targets = ["nsis", "appimage"]` only — there is no `.msi`, no `.dmg` (Apple Silicon / Intel), and no `.deb`. macOS users should build from source below.

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
git clone https://github.com/wisher567/Portpal.git
cd portpal

# Install & Run
npm install
npm run tauri dev
```

> **Note:** The app will launch with Vite HMR — you can freely edit React components and observe changes instantly alongside the Rust backend watcher.

---

## 🎯 Supported Frameworks

PortPal auto-detects these frameworks out-of-the-box:

| Port | Framework | Color |
|------|-----------|-------|
| 3000 | React | 🔵 Cyan |
| 4200 | Angular | 🔴 Red |
| 5173 | Vite | 🟣 Purple |
| 4000 | Node.js | 🟢 Green |
| 8000 | Django | 🟢 Emerald |
| 8080 | HTTP | 🟡 Amber |
| 5432 | Postgres | 🔵 Steel Blue |
| 6379 | Redis | 🔴 Crimson |
| 3306 | MySQL | 🔵 Blue |
| 27017 | MongoDB | 🟢 Forest |
| 1420 | Tauri | 🟡 Gold |

---

## 🏗️ Architecture

Restart uses backend-captured `program`, `args`, and working-directory values
with direct process execution on Windows, macOS, and Linux. `start_cmd` is
display-only; it must never be split or replayed through `cmd /C`, `cmd /K`, or
`sh -c`. Arguments stay separate, including paths with spaces. Existing launch
validation rejects shell metacharacters and unsafe paths; shell executables and
batch/PowerShell launchers are refused even inside a project. Restart the native
server executable instead of a shell wrapper.

| Layer | Technology |
|-------|-----------|
| **Runtime** | [Tauri 2](https://tauri.app) — Rust backend, native webview |
| **Frontend** | React 19 + TypeScript + Vite 7 |
| **Visualization** | D3.js v7 — Force-directed graph simulation (Port Map, temporarily disabled in v0.2) |
| **Styling** | Vanilla CSS — Custom Glassmorphism |
| **Port Engine** | Custom native scanner via `sysinfo` + standard OS tools |
| **Data Pipelines**| Singleton thread-safe event logger `lazy_static` |

---

## 🎒 Portable Version (No Installation Required)

If you don't want to install Node.js, Rust, or use an installer, you can download a fully portable version of PortPal!

1. Head over to the [Releases page](https://github.com/wisher567/Portpal/releases).
2. Download the appropriate file for your system:
   - **Windows:** Download `portpal.exe` (Requires [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) which is pre-installed on most Windows 10/11 PCs).
   - **Linux:** Download the `.AppImage` file. Remember to make it executable (`chmod +x portpal_*.AppImage`) before running.
3. Double-click and run! No installation needed.

---


## 🤝 Contributing

Contributions are heavily welcomed to make PortPal even more intelligent.

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feat/amazing-feature`
3. **Commit** your changes: `git commit -m 'Add amazing feature'`
4. **Push** to the branch: `git push origin feat/amazing-feature`
5. **Open** a Pull Request

### Roadmap & Ideas
- 🌐 Expanding supported framework signatures
- 🎨 Theme customization & light mode support
- 📦 Homebrew/Winget verification
- 🧪 Expanding unit and integration tests

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**If PortPal saved you from one more `EADDRINUSE`, give it a ⭐**

Made with 🦀 Rust + ⚛️ React + 💜 by [wisher](https://github.com/wisher567)

</div>
