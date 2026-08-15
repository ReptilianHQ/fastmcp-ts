# Releasing the ReptilianHQ repack

`@reptilianhq/fastmcp-ts` is distributed only as a public GitHub Release from
the `ReptilianHQ/fastmcp-ts` fork. It is not published to npm.

## Publish workflow

Run **Publish ReptilianHQ GitHub release** from GitHub Actions with:

- the exact package version committed in `package.json`
- the matching `v<version>` GitHub tag
- `confirm_release` enabled

The workflow verifies package, tag, and repository identity; installs from the
lockfile; typechecks; runs the complete test suite and publish-time artifact
checks; packs the npm-compatible tarball; writes `SHA256SUMS`; and creates or
updates a public GitHub release using the repository `GITHUB_TOKEN`.

No npm account, npm token, repository secret, or trusted-publisher setup is
used. Rerunning the workflow replaces the release assets for the same tag.

## Versioning

Repack versions append a ReptilianHQ identifier to the upstream version, for
example `1.5.0-reptilian.0`. Runtime changes must remain separate from an
upstream refresh and must be documented explicitly. Consumers can move back to
`@prefecthq/fastmcp-ts` after the static-token hardening ships upstream.
