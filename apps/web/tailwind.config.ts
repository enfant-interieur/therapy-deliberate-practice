import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"] ,
  theme: {
    extend: {
      colors: {
        ink: "#0b1220"
      },
      keyframes: {
        "versus-intro-enter": {
          "0%": { opacity: "0", transform: "scale(0.92) translateY(20px)", filter: "blur(8px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)", filter: "blur(0px)" }
        },
        "versus-intro-exit": {
          "0%": { opacity: "1", transform: "scale(1) translateY(0)", filter: "blur(0px)" },
          "100%": { opacity: "0", transform: "scale(1.05) translateY(-10px)", filter: "blur(6px)" }
        }
      },
      animation: {
        "versus-intro-enter": "versus-intro-enter 0.9s ease-out forwards",
        "versus-intro-exit": "versus-intro-exit 0.6s ease-in forwards"
      }
    }
  },
  plugins: []
} satisfies Config;
