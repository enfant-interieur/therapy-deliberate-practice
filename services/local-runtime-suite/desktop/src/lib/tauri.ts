import { invoke } from "@tauri-apps/api/core";

const TAURI_UNAVAILABLE_MESSAGE =
  "Desktop launcher APIs are unavailable. Use the Local Runtime app window (npm run tauri dev / installed build).";

const hasTauriGlobal = () => {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return Boolean(
    w.__TAURI__?.core?.invoke ||
      w.__TAURI_INTERNALS__?.invoke ||
      typeof w.__TAURI_IPC__ === "function"
  );
};

export const isTauriAvailable = () => hasTauriGlobal();

export async function invokeLauncher<T = void>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriAvailable()) {
    throw new Error(TAURI_UNAVAILABLE_MESSAGE);
  }
  return invoke<T>(command, args);
}
