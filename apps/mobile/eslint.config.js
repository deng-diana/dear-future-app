// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // Adopting a linter on an existing codebase: keep the crash-guardrail
    // (react-hooks/rules-of-hooks) as an ERROR — that is the exact rule whose
    // violation once took down a release build (a Hook below an early return).
    // The newer React-Compiler-flavored rules are valuable but noisy here, so we
    // start them as warnings (visible, non-blocking) and burn them down over time
    // instead of letting ~40 findings block every lint run.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/refs": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
]);
