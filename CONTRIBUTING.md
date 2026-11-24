# Contributing to Isabel

Thanks for helping. Bug reports, documentation fixes, and code are all welcome.

## Before you start

- Search existing issues first. For anything larger than a small fix, open an
  issue to agree the approach before you write code.
- Security problems go through [SECURITY.md](SECURITY.md), not a public issue.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

You need Node.js 20+, pnpm and Docker. `pnpm install`, then `pnpm demo` gives you
a working app with no external accounts. See [docs/development.md](docs/development.md).

## Make a change

1. Fork the repository and branch from `main`.
2. Make the change. Add or update tests; a fix without a test is incomplete.
3. Run all of these and fix what they report:

   ```bash
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm test
   ```

   For UI changes also run `pnpm exec playwright test --grep-invert "@live|@integration"`.

4. Open a pull request that says what changed and why. Keep it focused; unrelated
   cleanups go in separate pull requests.

Style: TypeScript strict mode, explicit types on exported functions, no
`any` without a reason. Prettier formats the code (`pnpm format`).

Terraform changes must pass `terraform fmt`, `terraform validate`, `tflint`,
`trivy config` and `checkov` (CI runs them). Never include real account IDs,
hostnames, or secrets in examples or tests; use `example.com` and the
documentation IP ranges.

## Sign your commits (DCO)

This project uses the [Developer Certificate of Origin](https://developercertificate.org/).
By signing off you confirm that you wrote the change or have the right to submit it
under the project's license. Add a `Signed-off-by` line with `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

Pull requests with unsigned commits cannot be merged. To fix one:
`git commit --amend -s` for the last commit, or `git rebase --signoff main` for a branch.

## Releases

Maintainers tag releases and record changes in [CHANGELOG.md](CHANGELOG.md).
Add a line under "Unreleased" for any user-visible change.

## License

By contributing you agree your work is licensed under the [Apache License 2.0](LICENSE).
