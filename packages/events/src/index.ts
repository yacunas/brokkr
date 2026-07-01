/**
 * @brokkr/events
 *
 * A strongly-typed event emitter / bus for TypeScript backends, zero dependencies.
 *
 * {@link TypedEmitter} keys every subscription and dispatch by an event map, so
 * event names and their payloads are fully checked. It supports synchronous
 * {@link TypedEmitter.emit} and awaited {@link TypedEmitter.emitAsync} dispatch,
 * one-shot {@link TypedEmitter.once} listeners, unsubscribe handles, and error
 * isolation so one failing listener never stops the rest.
 */

export { TypedEmitter } from "./emitter";
export type { Listener, TypedEmitterOptions } from "./emitter";
