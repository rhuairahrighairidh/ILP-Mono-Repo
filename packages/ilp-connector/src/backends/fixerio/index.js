'use strict'

const _ = require('lodash')
const request = require('co-request')
const BigNumber = require('bignumber.js')
const AssetsNotTradedError = require('../../errors/assets-not-traded-error')
const NoAmountSpecifiedError = require('../../errors/no-amount-specified-error')
const log = require('../../services/log')('fixerio')
const config = require('../../services/config')

const RATES_API = 'https://api.fixer.io/latest'

function lookupCurrencies (source_ledger, destination_ledger) {
  for (let pair of config.get('tradingPairs').toJS()) {
    if (pair[0].indexOf(source_ledger) === 4 &&
      pair[1].indexOf(destination_ledger) === 4) {
      return [pair[0].slice(0, 3), pair[1].slice(0, 3)]
    }
  }
  return null
}

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
   * Check if we trade the given pair of assets
   *
   * @param {String} source The URI of the source ledger
   * @param {String} destination The URI of the destination ledger
   * @return {boolean}
   */
  * hasPair (source, destination) {
    const currencyPair = lookupCurrencies(source, destination)
    return _.includes(this.currencies, currencyPair[0]) &&
      _.includes(this.currencies, currencyPair[1])
  }

  _formatAmount (amount) {
    return new BigNumber(amount).toFixed(2)
  }

  _formatAmountCeil (amount) {
    return new BigNumber(amount).times(100).ceil().div(100).toFixed(2)
  }

  _subtractSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).minus(this.spread))
  }

  _addSpread (amount) {
    return new BigNumber(amount).times(new BigNumber(1).plus(this.spread))
  }

  /**
   * Get a quote for the given parameters
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {String|Integer|BigNumber} params.source_amount The amount of the source asset we want to send (either this or the destination_amount must be set)
   * @param {String|Integer|BigNumber} params.destination_amount The amount of the destination asset we want to send (either this or the source_amount must be set)
   */
  * getQuote (params) {
    // Throw an error if the currency pair is not supported
    const hasPair = yield this.hasPair(params.source_ledger, params.destination_ledger)
    if (!hasPair) {
      console.log('doesnt have pair', params)
      throw new AssetsNotTradedError('This connector does not support the ' +
        'given asset pair')
    }

    // Get ratio between currencies and apply spread
    const currencyPair = lookupCurrencies(params.source_ledger, params.destination_ledger)
    const destinationRate = this.rates[currencyPair[1]]
    const sourceRate = this.rates[currencyPair[0]]
    let rate = new BigNumber(destinationRate).div(sourceRate)
    // The spread is subtracted from the rate when going in either direction,
    // so that the DestinationAmount always ends up being slightly less than
    // the (equivalent) SourceAmount -- regardless of which of the 2 is fixed:
    //
    //   SourceAmount * Rate * (1 - Spread) = DestinationAmount
    //
    rate = this._subtractSpread(rate)

    let sourceAmount, destinationAmount
    if (params.source_amount) {
      log.debug('creating quote with fixed source amount')
      sourceAmount = new BigNumber(params.source_amount)
      destinationAmount = new BigNumber(params.source_amount).times(rate)
    } else if (params.destination_amount) {
      log.debug('creating quote with fixed destination amount')
      sourceAmount = new BigNumber(params.destination_amount).div(rate)
      destinationAmount = new BigNumber(params.destination_amount)
    } else {
      throw new NoAmountSpecifiedError('Must specify either source ' +
        'or destination amount to get quote')
    }

    // Round amounts
    // TODO Rounding should be based on the level of precision the given ledger supports
    const AMOUNT_PRECISION = 4
    const roundedSourceAmount = sourceAmount.toFixed(AMOUNT_PRECISION, BigNumber.ROUND_UP)
    const roundedDestinationAmount = destinationAmount.toFixed(AMOUNT_PRECISION, BigNumber.ROUND_DOWN)

    let quote = {
      source_ledger: params.source_ledger,
      destination_ledger: params.destination_ledger,
      source_amount: roundedSourceAmount,
      destination_amount: roundedDestinationAmount
    }

    return quote
  }

  /**
   * Dummy function because we're not actually going
   * to submit the payment to any real backend, we're
   * just going to execute it on the ledgers we're connected to
   *
   * @param {String} params.source_ledger The URI of the source ledger
   * @param {String} params.destination_ledger The URI of the destination ledger
   * @param {Integer} params.source_amount The amount of the source asset we want to send
   * @param {Integer} params.destination_amount The amount of the destination asset we want to send
   * @return {Payment}
   */
  * submitPayment (params) {
    return params
  }
}

module.exports = FixerIoBackend
