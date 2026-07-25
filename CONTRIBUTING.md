# Contributing

Thanks for contributing to the ReptilianHQ fork of `fastmcp-ts`!

## Development

- Install: `npm ci`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`

## Releasing changes

The ReptilianHQ fork uses an explicit, manually confirmed GitHub Actions
workflow for RC repacks. Runtime changes should be developed separately and
must not be folded silently into an upstream repack.

Releases are cut by maintainers — see [`RELEASING.md`](./RELEASING.md).
