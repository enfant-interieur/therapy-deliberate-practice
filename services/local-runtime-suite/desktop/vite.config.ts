import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./src/testSetup.ts"],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
