import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#101e1c",
        slate: {
          50: "#f5f5ee",
          100: "#e8ede4",
          200: "#d1ddd4",
          300: "#b7c8bf",
          400: "#a3b9ac",
          500: "#95aa9e",
          600: "#526b60",
          700: "#354d43",
          800: "#263d34",
          900: "#1c3029",
          950: "#101e1c",
        },
        teal: {
          50: "#eff9e9",
          100: "#e0f3d4",
          200: "#c9e9b8",
          300: "#b0da96",
          400: "#9ac97e",
          500: "#7ab15e",
          600: "#5d8e43",
          700: "#466f32",
          800: "#355526",
          900: "#2a4320",
          950: "#14230e",
        },
      },
      keyframes: {
        "versus-intro-enter": {
          "0%": {
            opacity: "0",
            transform: "scale(0.92) translateY(20px)",
            filter: "blur(8px)",
          },
          "100%": {
            opacity: "1",
            transform: "scale(1) translateY(0)",
            filter: "blur(0px)",
          },
        },
        "versus-intro-exit": {
          "0%": {
            opacity: "1",
            transform: "scale(1) translateY(0)",
            filter: "blur(0px)",
          },
          "100%": {
            opacity: "0",
            transform: "scale(1.05) translateY(-10px)",
            filter: "blur(6px)",
          },
        },
      },
      animation: {
        "versus-intro-enter": "versus-intro-enter 0.9s ease-out forwards",
        "versus-intro-exit": "versus-intro-exit 0.6s ease-in forwards",
      },
    },
  },
  plugins: [],
} satisfies Config;
