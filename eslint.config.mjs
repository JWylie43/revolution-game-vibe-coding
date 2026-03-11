import eslint from "@eslint/js";
import eslintParser from "@typescript-eslint/parser";
import reactCompiler from "eslint-plugin-react-compiler";
import globals from "globals";
import tseslint from "typescript-eslint";

const tsOverrides = {
    "@typescript-eslint/no-unused-vars": "warn",
    "@typescript-eslint/no-require-imports": "warn",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/ban-ts-comment": "warn",
};

const reactRules = {
    "react-compiler/react-compiler": "error",
};

export default [
    {
        ignores: [
            "node_modules",
            "**/node_modules/*",
            "coverage",
            "**/dist/*",
            "**/build/*",
        ],
    },
    ...tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended),
    {
        plugins: { "react-compiler": reactCompiler },
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: "module",
            parser: eslintParser,
            globals: {
                ...globals.browser,
                ...globals.node,
                React: "readonly",
            },
        },
        rules: {
            "prefer-template": "warn",
            // TypeScript handles undefined variables more accurately than no-undef
            "no-undef": "off",
            curly: ["warn", "multi-line"],
            "no-throw-literal": "off",
            "prefer-promise-reject-errors": "warn",
            "no-unused-vars": "warn",
            "block-spacing": ["warn", "never"],
            "brace-style": ["warn", "stroustrup", { allowSingleLine: true }],
            camelcase: ["warn", { properties: "never" }],
            "comma-dangle": [
                "error",
                {
                    arrays: "always-multiline",
                    objects: "always-multiline",
                    imports: "never",
                    exports: "never",
                    functions: "never",
                },
            ],
            "eol-last": "warn",
            indent: ["warn", 4, { ignoredNodes: ["TemplateLiteral > *"] }],
            "max-len": [
                "warn",
                {
                    code: 150,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreTemplateLiterals: true,
                },
            ],
            "no-multiple-empty-lines": ["warn", { max: 2 }],
            "no-trailing-spaces": "warn",
            "object-curly-spacing": ["warn", "always"],
            "object-curly-newline": ["warn", { consistent: true }],
            quotes: ["warn", "double", { allowTemplateLiterals: true }],
            semi: "error",
            "space-before-blocks": "warn",
            "space-before-function-paren": [
                "warn",
                { asyncArrow: "always", anonymous: "never", named: "never" },
            ],
            "spaced-comment": ["warn", "always"],
            "arrow-parens": ["warn", "always"],
            "prefer-const": "warn",
            "no-unreachable": "warn",
            ...tsOverrides,
            ...reactRules,
        },
    },
];
