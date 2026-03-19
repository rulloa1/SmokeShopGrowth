'use strict';

const js = require('@eslint/js');

module.exports = [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                exports: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                fetch: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-undef': 'error',
            'no-console': 'off',
            'eqeqeq': 'warn',
            'no-var': 'error',
            'prefer-const': 'warn',
        },
    },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            sourceType: 'module',
        },
    },
    {
        files: ['src/node/spreadsheet_cleaner_tool.js'],
        languageOptions: {
            globals: {
                SpreadsheetApp: 'readonly',
            },
        },
    },
    {
        ignores: ['node_modules/', 'demo/', 'deployments/', 'templates/', 'archive/'],
    },
];
