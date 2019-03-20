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
      this.broadcast()
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
      this.broadcast()
    }.bind(this), this.routeBroadcastInterval)
  }

  broadcast () {
    const adjacentLedgers = Object.keys(this.peersByLedger)
    const routes = this.routingTables.toJSON(SIMPLIFY_POINTS)
    for (let adjacentLedger of adjacentLedgers) {
      const ledgerRoutes = routes.filter((route) => route.source_ledger === adjacentLedger)
      try {
        this._broadcastToLedger(adjacentLedger, ledgerRoutes)
      } catch (err) {
        log.warn('broadcasting routes on ledger ' + adjacentLedger + ' failed')
        log.debug(err)
      }
    }
  }

  _broadcastToLedger (adjacentLedger, routes) {
    const connectors = Object.keys(this.peersByLedger[adjacentLedger])
    for (let adjacentConnector of connectors) {
      const account = adjacentLedger + adjacentConnector
      log.info('broadcasting ' + routes.length + ' routes to ' + account)

      const broadcastPromise = this.core.getPlugin(adjacentLedger).sendMessage({
        ledger: adjacentLedger,
        account: account,
        data: {
          method: 'broadcast_routes',
          data: routes
        }
      })
      // timeout the plugin.sendMessage Promise just so we don't have it hanging around forever
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('route broadcast to ' + account + ' timed out')), this.routeBroadcastInterval)
      })

      // We are deliberately calling an async function synchronously because
      // we do not want to wait for the routes to be broadcasted before continuing.
      // Even if there is an error sending a specific route or a sendMessage promise hangs,
      // we should continue sending the other broadcasts out
      Promise.race([broadcastPromise, timeoutPromise])
        .catch((err) => {
          log.warn('broadcasting routes to ' + account + ' failed')
          log.debug(err)
        })
    }
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

  depeerLedger (prefix) {
    delete this.peersByLedger[prefix]
  }

  * reloadLocalRoutes () {
    const localRoutes = yield this._getLocalRoutes()
    yield this.routingTables.addLocalRoutes(this.infoCache, localRoutes)
  }

  _getLocalRoutes () {
    return Promise.all(this.tradingPairs.toArray().map(
      (pair) => co.wrap(this._tradingPairToLocalRoute).call(this, pair)))
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

  * _tradingPairToLocalRoute (pair) {
    const sourceLedger = pair[0].split('@').slice(1).join('@')
    const destinationLedger = pair[1].split('@').slice(1).join('@')
    const curve = yield this.backend.getCurve({
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger
    })
    const sourcePlugin = this.core.getPlugin(sourceLedger)
    const destinationPlugin = this.core.getPlugin(destinationLedger)
    const destinationInfo = yield this.infoCache.get(destinationLedger)
    return Route.fromData({
      source_ledger: sourceLedger,
      destination_ledger: destinationLedger,
      additional_info: curve.additional_info,
      min_message_window: this.minMessageWindow,
      source_account: (yield sourcePlugin.getAccount()),
      destination_account: (yield destinationPlugin.getAccount()),
      points: curve.points,
      destinationPrecision: destinationInfo.precision,
      destinationScale: destinationInfo.scale
    })
  }
}

module.exports = RouteBroadcaster
