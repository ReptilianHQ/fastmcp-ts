# Releasing the ReptilianHQ RC repack

`@reptilianhq/fastmcp-ts` is distributed only as a public GitHub Release from
the `ReptilianHQ/fastmcp-ts` fork. It is not published to npm.

## Publish workflow

Run **Publish GitHub RC** from GitHub Actions with:

- the exact package version committed in `package.json`
- the matching `v<version>` GitHub tag
- `confirm_release` enabled

The workflow verifies package, tag, and repository identity; installs from the
lockfile; typechecks; runs the complete test suite and publish-time artifact
checks; packs the npm-compatible tarball; writes `SHA256SUMS`; and creates or
updates a public GitHub prerelease using the repository `GITHUB_TOKEN`.

No npm account, npm token, repository secret, or trusted-publisher setup is
used. Rerunning the workflow replaces the release assets for the same tag.

## Versioning

Repack versions append a ReptilianHQ identifier to the upstream candidate, for
example `1.0.0-rc.0-reptilian.0`. Runtime changes must remain separate from an
upstream repack and must be documented explicitly. Once the equivalent upstream
package is available, consumers should move back to `@prefecthq/fastmcp-ts`.
