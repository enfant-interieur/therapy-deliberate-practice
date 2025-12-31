import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  if ((!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) && command === "build") {
    throw new Error(
      "Missing required VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in apps/web/.env or the build environment."
    );
  }

  return {
    plugins: [react()],
    server: { port: 5173 }
  };
});
