# @corgi-network/feed-sdk

> The package identity is reserved and configured for public npm publication. The first release remains gated on release review, licensing review, and CI-generated npm provenance.

Public type contract for implementing custom scoring components for
[Corgi](https://github.com/andrewnordstrom-eng/corgi).

The package exports the minimum surface a third-party component author needs:

| Export | Purpose |
|---|---|
| `ScoringComponent`, `ScoringContext` | The component contract |
| `PostForScoring` | The post shape components score against |
| `ScoreComponents`, `WeightedScore`, `ScoredPost` | The per-component decomposition contract |
| `GovernanceEpoch`, `GovernanceWeights`, `GovernanceWeightKey` | The community-voted weights in effect |
| `VotableWeightParam` | Voting-UI param config |
| `createComponent({ key, name, score })` | Helper that returns a typed `ScoringComponent` |
| `voteFieldForKey(key)` | Helper mapping camelCase keys to snake_case wide-column names (transitional; removed after PROJ-819) |

## Quickstart

```ts
import { createComponent, type PostForScoring, type ScoringContext } from '@corgi-network/feed-sdk';

export const civilityComponent = createComponent({
  key: 'civility',
  name: 'Civility',
  async score(post: PostForScoring, _context: ScoringContext): Promise<number> {
    if (!post.text) return 0.5;
    return classifyCivility(post.text);
  },
});

async function classifyCivility(text: string): Promise<number> {
  // Your model goes here.
  return 0.5;
}
```

## Contributing the component upstream

This package is the type contract. To register a component for community
voting, follow the contribution flow in
[`docs/contributing-scoring-components.md`](https://github.com/andrewnordstrom-eng/corgi/blob/main/docs/contributing-scoring-components.md)
in the main repository.

The short version:

1. Implement `ScoringComponent` against this SDK.
2. Open a GitHub issue; the repository workflow routes it to the maintainers'
   Bluesky Corgi Linear project.
3. Add the component to `src/scoring/registry.ts` `DEFAULT_COMPONENTS`.
4. Include an initial governance weight if the component should participate in
   ranking immediately.
5. Open a PR.

## Versioning

The SDK lives in the same monorepo as the feed implementation. Type changes
that would break component authors receive a major-version bump and documented
migration guidance.

## Architecture context

For the rationale behind the registry-driven, long-table-backed contract, see
[`docs/adr/ADR-0001-extensible-scoring-components.md`](https://github.com/andrewnordstrom-eng/corgi/blob/main/docs/adr/ADR-0001-extensible-scoring-components.md).

License: MIT.
