import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "coverage"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.browser
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
          allowExportNames: ["teamColorMap", "useToast"]
        }
      ]
    }
  },
  {
    files: ["*.config.{cjs,js,mjs}", "scripts/**/*.{cjs,js,mjs}"],
    languageOptions: {
      globals: globals.node
    }
  },
  {
    files: ["src/routes.tsx"],
    rules: {
      "react-refresh/only-export-components": "off"
    }
  }
);
