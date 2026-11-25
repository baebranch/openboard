import tseslint from 'typescript-eslint';

const banned = ['net', 'http', 'https', 'ws', 'child_process', 'dgram'];
// Cover both bare and `node:`-prefixed specifiers, and subpaths.
const build = (modules) => ({
  paths: modules.flatMap((name) => [
    { name, message: `OpenBoard must not use network or process modules ('${name}').` },
    { name: `node:${name}`, message: `OpenBoard must not use network or process modules ('${name}').` },
  ]),
  patterns: modules.flatMap((name) => [`${name}/*`, `node:${name}/*`]),
});

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    rules: {
      'no-restricted-imports': ['error', build(banned)],
    },
  },
  {
    // The local MCP channel (named pipe / Unix socket) and the MCP stdio server may use `net`.
    // Everything else stays banned, including TCP-capable modules (http, https, ws, dgram).
    files: ['src/host/ipc/**/*.ts', 'src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', build(banned.filter((m) => m !== 'net'))],
    },
  },
);
