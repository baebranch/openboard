# Security Policy

## Supported versions

Security fixes are provided for the latest released version.

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/openboard-dev/openboard/security/advisories/new)
for this repository and include:

- a description of the issue and its impact,
- steps to reproduce, or a proof of concept,
- the OpenBoard version, host application and OS.

You can expect an acknowledgement within a few days. Fixes are released as soon as practical, and reporters are credited in the changelog unless they prefer otherwise.

## Scope

Areas of particular interest: the QuickJS code-mode sandbox (`openboard_execute`), the local MCP channel (named pipe or Unix socket and its token), webview message handling, and `.openboard` file parsing.
