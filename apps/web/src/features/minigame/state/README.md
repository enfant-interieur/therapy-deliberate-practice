# Minigame State Module

The minigame experience needs to stay in sync with the backend session state, surface
derived view data, and expose a predictable API that other game modes can rely on.
This module consolidates all minigame state concerns into a single Redux feature.

## Data Model

- Session, teams, players, rounds, and results are normalized via RTK entity adapters.
- `view` stores light UI state (current round/player, overlay toggles, etc.).
- `selectMinigameSnapshot` exposes a consumable slice (arrays + current round/player).
- `selectMinigameDerivedState` adds memoized maps/sets (`playerMap`, `resultsByRound`,
  `completedRoundIdsByPlayer`, `pendingRoundIds`, …) so components don’t need to
  rebuild these structures on every render.

## Manager + Hooks

Use `useMinigameState()` inside UI:

```ts
const { snapshot: minigames, derived, manager } = useMinigameState();
```

- `snapshot` – ready-to-render data for the active session.
- `derived` – memoized lookup helpers (maps, sets, pending queue).
- `manager` – imperative helpers that wrap dispatch/getState.

Whenever the session graph changes, call `manager.verifyIntegrity()` (optionally with
`{ lockRoundAdvance: true }` while modals are open) to realign the active round/player
with the latest server truth. The method returns a log-friendly list of corrective
actions so regressions are easy to trace, and emits a `complete_session` action once all
rounds are finished so the UI can trigger end-of-game flows confidently.

### Manager API

| Method | Description |
| --- | --- |
| `hydrate(payload)` | Replace the entire session graph (server sync). |
| `reset()` | Clear all entities/UI state. |
| `setCurrentRound(roundId?)` | Focus the currently active round. |
| `setCurrentPlayer(playerId?)` | Pin the currently active player. |
| `registerResult(payload)` | Upsert a round result & auto-complete the round if applicable. |
| `verifyIntegrity({ lockRoundAdvance? })` | Runs guard-rails that realign round/player pointers and signals when the session is ready to end. |
| `toggleTranscript()` / `setEvaluationDrawer(open)` / `setEndGameOverlay(open)` / `setAppShellVisibility(hidden)` | UI helpers to flip individual flags. |
| `snapshot()` / `derived()` / `pendingRoundIds()` | Read-only accessors for advanced flows/testing. |

## Usage Guidelines

1. Always read from `useMinigameState()` instead of `state.minigames` directly.
2. Dispatch through `manager` so reducers stay encapsulated and we can evolve the
   implementation without touching every consumer.
3. Use the derived selectors before introducing new `useMemo` blocks in components.
4. When adding new UI concerns, extend the slice + selectors first, then wire them
   through the manager/hook so every minigame mode can reuse the same API surface.
