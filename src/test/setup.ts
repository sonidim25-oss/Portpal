import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock Tauri window APIs used in App.tsx titlebar
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    setFocus: vi.fn(),
    unminimize: vi.fn(),
  }),
}));

// Mock Tauri event listen - individual tests override via vi.mock or mockIPC
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
