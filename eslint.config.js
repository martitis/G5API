import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "docs/**", "node_modules/**", "public/**", "migrations/**", "coverage/**"]
  },
  {
    files: ["app.ts", "bin/**/*.ts", "src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      // DB rows are untyped (RowDataPacket/any) everywhere; revisit once queries are typed.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      // Existing violations, downgraded to warnings. CI caps the warning count (--max-warnings in
      // package.json "lint"), so it can only go down. Promote a rule to "error" once its category is fixed.
      "prefer-const": "warn",
      "no-var": "warn",
      "no-empty": "warn",
      "no-useless-catch": "warn",
      "no-useless-assignment": "warn",
      "no-unsafe-finally": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/no-floating-promises": "warn",
      // A leading underscore marks parameters that must exist (e.g. Express error handlers).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/unbound-method": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/only-throw-error": "warn",
      "@typescript-eslint/no-wrapper-object-types": "warn",
      "@typescript-eslint/no-for-in-array": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-this-alias": "warn"
    }
  },
  prettier
);
