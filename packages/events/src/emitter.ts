/**
 * A listener for a single event, receiving the event's typed payload.
 *
 * @typeParam T - The payload type delivered to this listener.
 */
export type Listener<T> = (payload: T) => void;

/**
 * Options accepted by the {@link TypedEmitter} constructor.
 *
 * @typeParam TEvents - A map of event name to payload type.
 */
export interface TypedEmitterOptions<TEvents extends Record<string, unknown>> {
  /**
   * Invoked when a listener throws (or rejects, during {@link TypedEmitter.emitAsync}).
   *
   * The emitter never lets one listener's failure stop the others; this hook is
   * the only place errors surface. If omitted, listener errors are swallowed.
   *
   * @param error - The value thrown or rejected by the listener.
   * @param event - The event whose listener failed.
   */
  onError?: (error: unknown, event: keyof TEvents) => void;
}

/**
 * A strongly-typed event emitter.
 *
 * Event names and their payload types are described by the `TEvents` map, so
 * `on`, `once`, `off`, `emit`, and `emitAsync` are all checked against the
 * declared payload for each event.
 *
 * @example
 * ```ts
 * type Events = {
 *   login: { userId: string };
 *   logout: void;
 * };
 *
 * const bus = new TypedEmitter<Events>();
 * const off = bus.on("login", ({ userId }) => console.log(userId));
 * bus.emit("login", { userId: "u_1" });
 * off();
 * ```
 *
 * @typeParam TEvents - A map of event name to payload type.
 */
export class TypedEmitter<TEvents extends Record<string, unknown>> {
  readonly #listeners = new Map<keyof TEvents, Set<Listener<unknown>>>();
  readonly #onError?: (error: unknown, event: keyof TEvents) => void;

  /**
   * @param options - Optional configuration, including an {@link TypedEmitterOptions.onError} hook.
   */
  constructor(options: TypedEmitterOptions<TEvents> = {}) {
    this.#onError = options.onError;
  }

  /**
   * Subscribe to an event.
   *
   * @param event - The event name to listen for.
   * @param listener - Called with the event payload each time the event fires.
   * @returns An unsubscribe function that removes this listener when called.
   */
  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const set = this.#listeners.get(event) ?? new Set<Listener<unknown>>();
    set.add(listener as Listener<unknown>);
    this.#listeners.set(event, set);
    return () => this.off(event, listener);
  }

  /**
   * Subscribe to an event for a single delivery. The listener is removed
   * automatically after it fires once.
   *
   * @param event - The event name to listen for.
   * @param listener - Called at most once with the event payload.
   * @returns An unsubscribe function that removes the listener before it fires.
   */
  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const wrapper: Listener<TEvents[K]> = (payload) => {
      this.off(event, wrapper);
      return listener(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Remove a previously registered listener. No-op if the listener was not
   * registered for the event.
   *
   * @param event - The event the listener was registered for.
   * @param listener - The exact listener reference to remove.
   */
  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<unknown>);
    if (set.size === 0) this.#listeners.delete(event);
  }

  /**
   * Synchronously deliver a payload to every listener registered for an event.
   *
   * Listeners are invoked in registration order over a snapshot, so mutating
   * subscriptions from within a listener does not affect the current dispatch.
   * A listener that throws does not prevent the others from running; the error
   * is routed to the {@link TypedEmitterOptions.onError} hook if provided.
   *
   * @param event - The event name to emit.
   * @param payload - The payload delivered to each listener.
   * @returns `true` if at least one listener was called, otherwise `false`.
   */
  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): boolean {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const listener of [...set]) {
      try {
        void listener(payload);
      } catch (error) {
        this.#reportError(error, event);
      }
    }
    return true;
  }

  /**
   * Deliver a payload to every listener and await any promises they return.
   *
   * All listeners are started concurrently and awaited together via
   * `Promise.all`. A listener that throws synchronously or rejects does not
   * prevent the others from settling; each error is routed to the
   * {@link TypedEmitterOptions.onError} hook if provided.
   *
   * @param event - The event name to emit.
   * @param payload - The payload delivered to each listener.
   * @returns A promise that resolves once all listeners have settled.
   */
  async emitAsync<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void> {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return;
    await Promise.all(
      [...set].map(async (listener) => {
        try {
          await listener(payload);
        } catch (error) {
          this.#reportError(error, event);
        }
      }),
    );
  }

  /**
   * Count the listeners currently registered for an event.
   *
   * @param event - The event name to inspect.
   * @returns The number of registered listeners.
   */
  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /**
   * Remove all listeners for a single event, or for every event when no event
   * is given.
   *
   * @param event - The event to clear. Omit to clear all events.
   */
  removeAllListeners<K extends keyof TEvents>(event?: K): void {
    if (event === undefined) {
      this.#listeners.clear();
      return;
    }
    this.#listeners.delete(event);
  }

  #reportError(error: unknown, event: keyof TEvents): void {
    this.#onError?.(error, event);
  }
}
