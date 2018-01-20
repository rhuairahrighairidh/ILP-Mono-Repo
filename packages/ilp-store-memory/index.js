module.exports = class MemoryStore {
  constructor () {
    this._store = new Map()
  }

  async get (k) {
    return this._store.get(k)
  }

  async put (k, v) {
    this._store.set(k, v)
  }

  async del (k) {
    this._store.delete(k)
  }
}
