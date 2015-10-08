'use strict'
const request = require('co-request')
const FixerIoBackend = require('./fixerio')
const CHARTS_API = 'https://api.ripplecharts.com/api/exchange_rates'
const EUR_ISSUER = 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B' // bitstamp

class FixerIoXRPBackend extends FixerIoBackend {
  * connect (mockData) {
    yield super.connect(mockData)
    this.rates.XRP = yield this._getXRPRate()
    this.currencies.push('XRP')
    this.currencies.sort()
  }

  * _getXRPRate () {
    let rateRes = yield request({
      method: 'post',
      uri: CHARTS_API,
      json: true,
      body: {
        base: {
          currency: 'EUR',
          issuer: EUR_ISSUER
        },
        counter: { currency: 'XRP' }
      }
    })
    if (rateRes.statusCode !== 200) {
      throw new Error('Unexpected status from ripplecharts: ' + rateRes.statusCode)
    }
    return +(rateRes.body[0].rate.toFixed(5))
  }
}

module.exports = FixerIoXRPBackend
