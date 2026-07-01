# @brokkr/events

A strongly-typed event emitter / bus for TypeScript. Event names and their
payloads are described by a single type map, so every subscription and dispatch
is fully type-checked. Zero runtime dependencies.

## Install

```sh
pnpm add @brokkr/events
```

## Usage

```ts
import { TypedEmitter } from "@brokkr/events";

type Events = {
  login: { userId: string };
  count: number;
  ping: void;
};

const bus = new TypedEmitter<Events>({
  onError: (error, event) => console.error(`listener for "${String(event)}" failed`, error),
});

// `on` returns an unsubscribe handle.
const off = bus.on("login", ({ userId }) => {
  console.log("logged in:", userId);
});

bus.emit("login", { userId: "u_1" }); // true — a listener ran
off();
bus.emit("login", { userId: "u_2" }); // false — no listeners
```

## API

### `new TypedEmitter<TEvents>(options?)`

`options.onError?: (error, event) => void` — invoked whenever a listener throws
(sync `emit`) or rejects (`emitAsync`). One failing listener never stops the
others; if `onError` is omitted, listener errors are swallowed.

### Methods

- `on(event, listener): () => void` — subscribe; returns an unsubscribe function.
- `once(event, listener): () => void` — subscribe for a single delivery.
- `off(event, listener): void` — remove a specific listener.
- `emit(event, payload): boolean` — synchronous dispatch; returns whether any
  listener was called.
- `emitAsync(event, payload): Promise<void>` — dispatch and await async
  listeners (run concurrently via `Promise.all`).
- `listenerCount(event): number` — listeners registered for an event.
- `removeAllListeners(event?): void` — clear one event, or all events when
  called with no argument.

## License

MIT © Yronnel James
