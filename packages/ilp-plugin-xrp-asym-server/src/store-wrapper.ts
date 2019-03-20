import { Store } from './util'

export default class StoreWrapper {
  private _store?: Store
  private _cache: Map<string, string | void | object>
  private _write: Promise<void>

  constructor (store: Store) {
    this._store = store
    this._cache = new Map()
    this._write = Promise.resolve()
  }

  async loadString (key: string) { return this._load(key, false) }
  async loadObject (key: string) { return this._load(key, true) }

  private async _load (key: string, parse: boolean) {
    if (!this._store) return
    if (this._cache.has(key)) return
    const value = await this._store.get(key)

    // once the call to the store returns, double-check that the cache is still empty.
    if (!this._cache.has(key)) {
      this._cache.set(key, (parse && value) ? JSON.parse(value) : value)
    }
  }

  unload (key: string) {
    if (this._cache.has(key)) {
      this._cache.delete(key)
    }
  }

  getString (key: string): string | void {
    const val = this._cache.get(key)
    if (val === undefined || typeof val === 'string') return val
    throw new Error('StoreWrapper#getString: unexpected type for key=' + key)
  }

  getObject (key: string): object | void {
    const val = this._cache.get(key)
    if (val === undefined || typeof val === 'object') return val
    throw new Error('StoreWrapper#getObject: unexpected type for key=' + key)
  }

  set (key: string, value: string | object) {
    this._cache.set(key, value)
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : value
    this._write = this._write.then(() => {
      if (this._store) {
        return this._store.put(key, valueStr)
      }
    })
  }

  delete (key: string) {
    this._cache.delete(key)
    this._write = this._write.then(() => {
      if (this._store) {
        return this._store.del(key)
      }
    })
  }

  setCache (key: string, value: string) {
    this._cache.set(key, value)
  }
}
