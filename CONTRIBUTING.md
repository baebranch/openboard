# Contributing to OpenBoard

Thanks for your interest in OpenBoard. Bug reports, ideas and pull requests are all welcome.

## Getting started

Requires Node.js 22 and npm.

```
npm ci
npm run build          # builds dist/
npm run watch          # rebuilds on change
```

Press `F5` in VS Code to launch an Extension Development Host (see `.vscode/launch.json`).

## Before you open a pull request

```
npm run typecheck
npm run lint
npm test
npm run check:manifest
```

- `npm run check:manifest` verifies that the generated parts of `package.json` (the language model tools) are in sync. If it fails, run `npm run gen:manifest` and commit the result.
- `npm run test:integration` runs the suite inside a real VS Code. It downloads VS Code on first run.
- Add or update tests for behavior changes, and add an entry under **Unreleased** in `CHANGELOG.md`.
- Keep pull requests focused. Describe what changed and why.

## Reporting bugs

Open an issue with the OpenBoard and VS Code versions, your OS, steps to reproduce, and a minimal `.openboard` file if the problem is file-specific. For security problems, see [SECURITY.md](SECURITY.md) instead.

## Releasing (maintainers)

1. Move the **Unreleased** entries in `CHANGELOG.md` under a new version heading with the date, and update the compare links at the bottom.
2. Bump `version` in `package.json` (`npm version <patch|minor|major> --no-git-tag-version`).
3. Commit and push to `main`. Do not create the tag yourself: the workflow releases only versions that have no `vX.Y.Z` tag yet, and creates the tag when it succeeds.
4. The **Release** workflow verifies and packages one `.vsix`, publishes that exact file to the Visual Studio Marketplace and Open VSX (the SHA-256 is checked before each upload), then creates the `vX.Y.Z` tag and the GitHub release with the `.vsix`, its checksum and notes taken from the changelog. The `VSCE_PAT` and `OVSX_PAT` repository secrets are required. If a job fails, use **Re-run failed jobs**: a store that already has the version is skipped and the release assets are replaced with the same files.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
