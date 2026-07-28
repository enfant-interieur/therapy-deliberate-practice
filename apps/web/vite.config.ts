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
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            maxSize: 250_000,
            groups: [
              {
                name: "react-vendor",
                test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/,
                priority: 40
              },
              {
                name: "data-vendor",
                test: /node_modules[\\/](?:@reduxjs|react-redux|@supabase)[\\/]/,
                priority: 30
              },
              {
                name: "i18n-vendor",
                test: /node_modules[\\/](?:i18next|react-i18next|i18next-browser-languagedetector)[\\/]/,
                priority: 20
              },
              {
                name: "vendor",
                test: /node_modules[\\/]/,
                priority: 10
              }
            ]
          }
        }
      }
    },
    server: {
      port: 5173,
      ...(command === "serve"
          ? {
            proxy: {
              "/api": {
                target: "http://localhost:8787",
                changeOrigin: true,
                secure: false
              }
            }
          }
          : {})
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"]
    }
  };
});
