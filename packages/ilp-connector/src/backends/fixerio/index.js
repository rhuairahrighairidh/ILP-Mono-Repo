'use strict'

const _ = require('lodash')
const request = require('co-request')
const BigNumber = require('bignumber.js')
const log = require('../../common').log.create('fixerio')
const ServerError = require('five-bells-shared/errors/server-error')
const healthStatus = require('../../common/health.js')
// This simple backend uses a fixed (large) source amount and a rate to generate
// the destination amount for the curve.
const PROBE_AMOUNT = new BigNumber(10).pow(14) // stays within 15 max digits for BigNumber from Number

const RATES_API = 'https://api.fixer.io/latest'

/**
 * Dummy backend that uses Fixer.io API for FX rates
 */
class FixerIoBackend {
  /**
   * Constructor.
   *
   * @param {Integer} opts.spread The spread we will use to mark up the FX rates
   * @param {String} opts.ratesApiUrl The API endpoint we will request rates from
   */
  constructor (opts) {
    if (!opts) {
      opts = {}
    }

    this.spread = opts.spread || 0
    this.getInfo = opts.getInfo
    this.getBalance = opts.getBalance
    // this.ratesCacheTtl = opts.ratesCacheTtl || 24 * 3600000

    this.rates = {}
    this.currencies = []
  }

  /**
   * Get the rates from the API
   *
   * Mock data can be provided for testing purposes
   */
  * connect (mockData) {
    log.debug('connect')

    let apiData
    if (mockData) {
      apiData = mockData
    } else {
      let result = yield request({
        uri: RATES_API,
        json: true
      })
      apiData = result.body
    }
    this.rates = apiData.rates
    this.rates[apiData.base] = 1
    this.currencies = _.keys(this.rates)
    this.currencies.sort()
  }

  /**
   * Get backend status
   */
  * getStatus () {
    return {
      backendStatus: healthStatus.statusOk
    }
  }

  _formatAmount (amount) {
    return new BigNumber(amount).toFixed(2)
  }

  _formatAmountCeil (amount) {
    return new BigNumber(amount).times(100).ceil().div(100).toFixed(2)
  }

  /**
   * Get a liquidity curve for the given parameters.
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_currency The source currency
   * @param {String} params.destination_currency The destination currency
   * @returns {Promise.<Object>}
   */
  * getCurve (params) {
    // Get ratio between currencies and apply spread
    const destinationRate = this.rates[params.destination_currency]
    const sourceRate = this.rates[params.source_currency]

    if (!sourceRate) {
      throw new ServerError('No rate available for currency ' + params.source_currency)
    }

    if (!destinationRate) {
      throw new ServerError('No rate available for currency ' + params.destination_currency)
    }

    const sourceInfo = this.getInfo(params.source_ledger)
    const destinationInfo = this.getInfo(params.destination_ledger)

    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * Rate * (1 - Spread) = DestinationAmount
    //
    const rate = new BigNumber(destinationRate).shift(destinationInfo.currencyScale)
      .div(new BigNumber(sourceRate).shift(sourceInfo.currencyScale))
      .times(new BigNumber(1).minus(this.spread))

    let limit
    if (sourceInfo.maxBalance !== undefined) {
      let balanceIn = yield this.getBalance(params.source_ledger)
      let maxAmountIn = new BigNumber(sourceInfo.maxBalance).minus(balanceIn)
      limit = [ maxAmountIn.toString(), maxAmountIn.times(rate).toString() ]
    }
    if (destinationInfo.minBalance !== undefined) {
      let balanceOut = yield this.getBalance(params.destination_ledger)
      let maxAmountOut = new BigNumber(balanceOut).minus(destinationInfo.minBalance)
      if (limit === undefined || maxAmountOut.lessThan(limit[1])) {
        limit = [ maxAmountOut.div(rate).toString(), maxAmountOut.toString() ]
      }
    }

    if (limit) {
      if (limit[1] === 0) { // the route exists in theory, but the connector is either at max source balance or at min destination balance
        return { points: [] }
      }
      // avoid repeating non-increasing [0, 0], [0, 0], ...
      return limit[0] === '0'
        ? { points: [ [0, 0], [ PROBE_AMOUNT, limit[1] ] ] }
        : { points: [ [0, 0], limit ] }
    // Make sure that neither amount exceeds 15 significant digits.
    } else if (rate.gt(1)) {
      return { points: [ [0, 0], [ PROBE_AMOUNT / rate, PROBE_AMOUNT ] ] }
    } else {
      return { points: [ [0, 0], [ PROBE_AMOUNT, PROBE_AMOUNT * rate ] ] }
    }
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to any real backend, we're
   * just going to execute it on the ledgers we're connected to
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String} params.source_amount The amount of the source asset we want to send
   * @param {String} params.destination_amount The amount of the destination asset we want to send
   * @return {Promise.<null>}
   */
  * submitPayment (params) {
    return Promise.resolve(null)
  }
}

module.exports = FixerIoBackend
