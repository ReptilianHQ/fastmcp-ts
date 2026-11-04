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
checks; packs the npm-compatible tarball; writes `SHA256SUMS`; and creates a
public GitHub release using the repository `GITHUB_TOKEN`.

No npm account, npm token, repository secret, or trusted-publisher setup is
used. The package is marked private to block npm publication. Release assets
are immutable; rerunning the workflow for an existing release fails.

The `1.7.3-reptilian.2` candidate preserves stateful legacy HTTP, including
elicitation and signed approval continuations. A session-bearing HTTP 404 marks
the client connection expired and stops its stale background stream. The next
explicit operation shares one fresh initialization; failed operations are never
replayed. Existing in-flight results, subscription registration, reference
ownership and shutdown remain part of the client lifecycle regression suite.
Unknown server sessions return the SDK's JSON-RPC `-32001` error envelope.

## Versioning

Repack versions append a ReptilianHQ identifier to the upstream version, for
example `1.7.3-reptilian.1`. Runtime changes must remain separate from an
upstream refresh and must be documented explicitly. Consumers can move back to
`@prefecthq/fastmcp-ts` after the static-token hardening ships upstream.
