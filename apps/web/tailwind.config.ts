import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0D2025",
        slate: {
          50: "#F4F1EA",
          100: "#E7ECE5",
          200: "#D5DFD9",
          300: "#C2D2CE",
          400: "#9FB9B5",
          500: "#91ACA9",
          600: "#698C8F",
          700: "#365960",
          800: "#1D3B42",
          900: "#163137",
          950: "#0D2025",
        },
        teal: {
          50: "#F0F7F3",
          100: "#E2F0E9",
          200: "#D1E5DD",
          300: "#B5D7CF",
          400: "#9EC9BF",
          500: "#74ABA3",
          600: "#528C86",
          700: "#326C69",
          800: "#255452",
          900: "#1C4142",
          950: "#102B2E",
        },
        clay: "#E8BAA6",
        sand: "#D8C18C",
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
