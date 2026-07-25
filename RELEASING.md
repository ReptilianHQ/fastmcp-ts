# Releasing the ReptilianHQ RC repack

`@reptilianhq/fastmcp-ts` republishes a verified upstream FastMCP release
candidate from the public `ReptilianHQ/fastmcp-ts` fork. Runtime source changes
must remain separate from repack-only releases and must be described explicitly.

## Publish workflow

Run **Publish Reptilian RC** from GitHub Actions and provide the exact version
already committed in `package.json`. The workflow verifies the package and
repository identity, installs from the lockfile, typechecks, runs the complete
test suite and publish-time artifact checks, then publishes publicly with the
`rc` npm dist-tag and provenance.

The workflow refuses to run outside `ReptilianHQ/fastmcp-ts` and requires the
operator to enable the `confirm_publish` input.

## npm authentication

For the first publication of a brand-new npm package, add a granular npm
automation token with publish access as the repository Actions secret
`NPM_TOKEN`. After the package exists, configure npm Trusted Publishing for:

- GitHub organization: `ReptilianHQ`
- repository: `fastmcp-ts`
- workflow filename: `release.yml`
- allowed action: `npm publish`

Once Trusted Publishing succeeds, delete `NPM_TOKEN`. The workflow's
`id-token: write` permission and exact repository metadata enable npm's OIDC
authentication and automatic provenance.

## Versioning

Repack versions append a ReptilianHQ identifier to the upstream candidate, for
example `1.0.0-rc.0-reptilian.0`. Never move `latest`; publish these builds only
under `rc`. Once the equivalent upstream package is available, consumers should
move back to `@prefecthq/fastmcp-ts`.
