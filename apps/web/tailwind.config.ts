import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#171322",
        slate: {
          50: "#FCF5EF",
          100: "#F4EAF2",
          200: "#EDE1EE",
          300: "#DDD0E8",
          400: "#BCACCD",
          500: "#A899B9",
          600: "#85769C",
          700: "#534560",
          800: "#332943",
          900: "#272038",
          950: "#171322",
        },
        teal: {
          50: "#FAF6FF",
          100: "#F0E5FF",
          200: "#E5D8FF",
          300: "#D6C4FF",
          400: "#C4AAFA",
          500: "#AE8EE5",
          600: "#8C6CBD",
          700: "#6E509E",
          800: "#533E7B",
          900: "#3C2C58",
          950: "#281F3C",
        },
        clay: "#FFC2A1",
        sand: "#E8C885",
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
