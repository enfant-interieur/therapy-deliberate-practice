import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => {
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
                priority: 40,
              },
              {
                name: "data-vendor",
                test: /node_modules[\\/](?:@reduxjs|react-redux|better-auth|@better-auth|nanostores)[\\/]/,
                priority: 30,
              },
              {
                name: "i18n-vendor",
                test: /node_modules[\\/](?:i18next|react-i18next|i18next-browser-languagedetector)[\\/]/,
                priority: 20,
              },
              {
                name: "vendor",
                test: /node_modules[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      port: 5173,
      ...(command === "serve"
        ? {
            proxy: {
              "/api": {
                target: "http://localhost:8787",
                changeOrigin: true,
                secure: false,
              },
            },
          }
        : {}),
    },
    test: {
      environment: "node",
      include: ["src/**/*.test.ts"],
    },
  };
});
