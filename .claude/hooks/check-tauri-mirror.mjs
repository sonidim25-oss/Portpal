// PostToolUse hook: warn when src-tauri/src/main.rs and lib.rs stop registering
// the same set of IPC commands. Both files build their own tauri::Builder, so a
// command added to only one of them silently exists in only one target.
//
// `greet` is a known, accepted lib.rs-only command and is ignored.
//
// Reads the hook payload on stdin, prints JSON on stdout, always exits 0.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const IGNORED = new Set(["greet"]);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TARGETS = ["main.rs", "lib.rs"];

const read = () =>
  new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(""));
  });

function commandsIn(file) {
  const src = readFileSync(join(ROOT, "src-tauri", "src", file), "utf8");
  const m = src.match(/generate_handler!\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  return new Set(
    m[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("//") && !IGNORED.has(s)),
  );
}

const payload = await read();
let filePath = "";
try {
  const j = JSON.parse(payload || "{}");
  filePath = j?.tool_input?.file_path || j?.tool_response?.filePath || "";
} catch {
  process.exit(0);
}

const norm = filePath.replace(/\\/g, "/");
if (!/src-tauri\/src\/(main|lib)\.rs$/.test(norm)) process.exit(0);

let main, lib;
try {
  [main, lib] = TARGETS.map(commandsIn);
} catch {
  process.exit(0); // file unreadable mid-edit; not our problem
}
if (!main || !lib) process.exit(0);

const missingInMain = [...lib].filter((c) => !main.has(c));
const missingInLib = [...main].filter((c) => !lib.has(c));
if (!missingInMain.length && !missingInLib.length) process.exit(0);

const parts = [];
if (missingInMain.length)
  parts.push(`missing from main.rs: ${missingInMain.join(", ")}`);
if (missingInLib.length)
  parts.push(`missing from lib.rs: ${missingInLib.join(", ")}`);
const msg = `Tauri command registration diverged — ${parts.join("; ")}. Both main.rs and lib.rs must register the same commands (main.rs is the shipped binary).`;

process.stdout.write(
  JSON.stringify({
    systemMessage: msg,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: msg,
    },
  }),
);
