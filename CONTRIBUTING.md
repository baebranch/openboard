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
3. Commit, then tag and push: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
4. The **Release** workflow builds the `.vsix`, creates the GitHub release with notes taken from the changelog, and publishes to the Visual Studio Marketplace and Open VSX when the `VSCE_PAT` and `OVSX_PAT` repository secrets are set.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
