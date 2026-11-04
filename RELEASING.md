# Releasing the ReptilianHQ repack

`@reptilianhq/fastmcp-ts` is distributed only as a public GitHub Release from
the `ReptilianHQ/fastmcp-ts` fork. It is not published to npm.

## Publish workflow

Run **Publish ReptilianHQ GitHub release** from GitHub Actions with:

- the exact package version committed in `package.json`
- the matching `v<version>` GitHub tag
- `confirm_release` enabled

The workflow verifies package, tag, repository identity, and that the declared
upstream release is an ancestor of the fork; installs from the
lockfile; typechecks; runs the complete test suite and publish-time artifact
checks; packs the npm-compatible tarball; writes `SHA256SUMS`; and creates a
public GitHub release using the repository `GITHUB_TOKEN`.

No npm account, npm token, repository secret, or trusted-publisher setup is
used. The package is marked private to block npm publication. Release assets
are immutable; rerunning the workflow for an existing release fails.

The `1.9.0-reptilian.0` candidate adds `VerificationUnavailableError` for token
and request verifiers. Introspection failures return HTTP 503 without a bearer
challenge; explicit inactive-token verdicts remain 401. Retry guidance is
validated and limited to five minutes. The regression suite covers both
protocol eras, bounded introspection deadlines, malformed responses, verifier
composition, and rejection before handler dispatch. This addresses the behavior
reported in [upstream issue #144](https://github.com/PrefectHQ/fastmcp-ts/issues/144).

Custom verifiers and audit wrappers must preserve this error type when adopting
the release. The library does not change consumer-specific credential policy.
Existing expired-session recovery remains unchanged. The upstream base is exactly
`v1.9.0` (`b8d1e365b3352fb868e6b6b2678a5f5fe4e850a8`). External OAuth
metadata now uses upstream `remoteAuth`; the fork-only `protectedResource` option
is retired, and consumers must move their metadata configuration to that wrapper.

Run `node scripts/check-upstream-base.mjs` locally to verify the same ancestry.
It fetches the upstream tag derived from the package version. A fork patch
release advances only the Reptilian suffix; refreshing upstream advances the
upstream version prefix and imports that exact tag. Consumer pins and deployed
versions are separate evidence and must be reported explicitly.

## Versioning

Repack versions append a ReptilianHQ identifier to the upstream version, for
example `1.7.3-reptilian.1`. Runtime changes must remain separate from an
upstream refresh and must be documented explicitly. Consumers can move back to
`@prefecthq/fastmcp-ts` after upstream provides equivalent static-token, session-recovery, metadata, and verification-failure contracts.
