'use strict'

const RouteBuilder = require('../lib/route-builder')
const config = require('./config')
module.exports = new RouteBuilder(
  require('./routing-tables'),
  require('./info-cache'),
  require('./core'),
  {
    minMessageWindow: config.expiry.minMessageWindow,
    slippage: config.slippage
  }
)
