# ILP Store Wrapper
> Synchronous wrapper around ILP store

The constructor takes an ILP store.

```js
const wrappedStore = new StoreWrapper(store)
```

- `.load(key) -> Promise<null>` will read a key asynchronously into the cache.
- `.get(key) -> value` will synchronously read from the cache.
- `.set(key, value) -> null` will synchronously write to the cache and queue a write to the store (with order guaranteed).
- `.delete(key) -> null` will synchronously delete from the cache and queue a delete to the store (with order guaranteed).
- `.setCache(key, value) -> null` will synchronously write to the cache and NOT queue any write to the store.
