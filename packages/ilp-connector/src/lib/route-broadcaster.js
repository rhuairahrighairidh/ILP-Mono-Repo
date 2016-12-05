'use strict'

const co = require('co')
const defer = require('co-defer')
const Route = require('ilp-routing').Route
const log = require('../common').log.create('route-broadcaster')
const SIMPLIFY_POINTS = 10

class RouteBroadcaster {
  /**
   * @param {RoutingTables} routingTables
   * @param {Backend} backend
   * @param {ilp-core.Core} core
   * @param {InfoCache} infoCache
   * @param {Object} config
   * @param {Object} config.tradingPairs
   * @param {Number} config.minMessageWindow
   * @param {Number} config.routeCleanupInterval
   * @param {Number} config.routeBroadcastInterval
   * @param {Boolean} config.autoloadPeers
   * @param {URI[]} config.peers
   * @param {Object} config.ledgerCredentials
   */
  constructor (routingTables, backend, core, infoCache, config) {
    if (!core) {
      throw new TypeError('Must be given a valid Core instance')
    }

    this.routeCleanupInterval = config.routeCleanupInterval
    this.routeBroadcastInterval = config.routeBroadcastInterval
    this.routingTables = routingTables
    this.backend = backend
    this.core = core
    this.infoCache = infoCache
    this.tradingPairs = config.tradingPairs
    this.minMessageWindow = config.minMessageWindow
    this.ledgerCredentials = config.ledgerCredentials
    this.configRoutes = config.configRoutes

    this.autoloadPeers = config.autoloadPeers
    this.defaultPeers = config.peers
    this.peersByLedger = {} // { ledgerPrefix ⇒ { connectorName ⇒ true } }
  }

  * start () {
    yield this.crawl()
    try {
      yield this.reloadLocalRoutes()
      yield this.addConfigRoutes()
      yield this.broadcast()
    } catch (e) {
      if (e.name === 'SystemError' ||
          e.name === 'ServerError') {
        // System error, in that context that is a network error
        // This will be retried later, so do nothing
      } else {
        throw e
      }
    }
    setInterval(() => this.routingTables.removeExpiredRoutes(), this.routeCleanupInterval)
    defer.setInterval(function * () {
      yield this.reloadLocalRoutes()
      yield this.broadcast()
    }.bind(this), this.routeBroadcastInterval)
  }

  broadcast () {
    const adjacentLedgers = Object.keys(this.peersByLedger)
    const routes = this.routingTables.toJSON(SIMPLIFY_POINTS)
    return Promise.all(adjacentLedgers.map((adjacentLedger) => {
      return this._broadcastToLedger(adjacentLedger,
        routes.filter((route) => route.source_ledger === adjacentLedger))
    }))
  }

  _broadcastToLedger (adjacentLedger, routes) {
    const connectors = Object.keys(this.peersByLedger[adjacentLedger])
    return Promise.all(connectors.map((adjacentConnector) => {
      const account = adjacentLedger + adjacentConnector
      log.info('broadcasting ' + routes.length + ' routes to ' + account)
      return this.core.getPlugin(adjacentLedger).sendMessage({
        ledger: adjacentLedger,
        account: account,
        data: {
          method: 'broadcast_routes',
          data: routes
        }
      }).catch((err) => {
        if (err.name !== 'NoSubscriptionsError') throw err
        log.warn('broadcasting routes to ' + account + ' failed: ' + err.message)
      })
    }))
  }

  crawl () {
    return this.core.getClients().map(this._crawlClient, this)
  }

  * _crawlClient (client) {
    const prefix = yield client.getPlugin().getPrefix()
    const localAccount = yield client.getPlugin().getAccount()
    const connectors = yield client.getConnectors()
    for (const connector of connectors) {
      // Don't broadcast routes to ourselves.
      if (localAccount === prefix + connector) continue
      if (this.autoloadPeers || this.defaultPeers.indexOf(prefix + connector) !== -1) {
        this.peersByLedger[prefix] = this.peersByLedger[prefix] || {}
        this.peersByLedger[prefix][connector] = true
        log.info('adding peer ' + connector + ' via ledger ' + prefix)
      }
    }
  }

  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    yield this.routingTables.addLocalRoutes(this.infoCache, localRoutes)
  }

  _getLocalRoutes () {
    return Promise.all(this.tradingPairs.toArray().map(
      (pair) => this._tradingPairToLocalRoute(pair)))
  }

  addConfigRoutes () {
    for (let configRoute of this.configRoutes) {
      const connectorLedger = configRoute.connectorLedger
      const connector = configRoute.connectorAccount
      const targetPrefix = configRoute.targetPrefix

      const route = new Route(
        // use a 1:1 curve as a placeholder (it will be overwritten by a remote quote)
        [ [0, 0], [1, 1] ],
        // the second ledger is inserted to make sure this the hop to the
        // connectorLedger is not considered final.
        [ connectorLedger, targetPrefix ],
        { minMessageWindow: this.minMessageWindow,
          sourceAccount: connector,
          targetPrefix: targetPrefix }
      )

      this.routingTables.addRoute(route)
    }

    // returns a promise in order to be similar to reloadLocalRoutes()
    return Promise.resolve(null)
  }

  _tradingPairToLocalRoute (pair) {
    const sourceLedger = pair[0].split('@').slice(1).join('@')
    const destinationLedger = pair[1].split('@').slice(1).join('@')
    // TODO change the backend API to return curves, not points
    return co(function * () {
      const quote = yield this.backend.getQuote({
        source_ledger: sourceLedger,
        destination_ledger: destinationLedger,
        source_amount: 100000000
      })
      return yield this._quoteToLocalRoute(quote)
    }.bind(this))
  }

  * _quoteToLocalRoute (quote) {
    const sourcePlugin = this.core.getPlugin(quote.source_ledger)
    const destinationPlugin = this.core.getPlugin(quote.destination_ledger)
    return Route.fromData({
      source_ledger: quote.source_ledger,
      destination_ledger: quote.destination_ledger,
      additional_info: quote.additional_info,
      min_message_window: this.minMessageWindow,
      source_account: (yield sourcePlugin.getAccount()),
      destination_account: (yield destinationPlugin.getAccount()),
      points: [
        [0, 0],
        [+quote.source_amount, +quote.destination_amount]
      ]
    })
  }
}

module.exports = RouteBroadcaster
