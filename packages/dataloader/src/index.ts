/**
 * @brokkr/dataloader
 *
 * A batching and caching data loader for TypeScript backends, zero
 * dependencies. {@link DataLoader} coalesces every per-tick `load(key)` into a
 * single call to your batch function — eliminating N+1 queries — and dedupes
 * repeated keys through a per-key promise cache with priming and manual
 * invalidation. The classic DataLoader pattern, cleanly typed.
 */

export { DataLoader, type DataLoaderOptions, type BatchLoadFn } from "./dataloader";
