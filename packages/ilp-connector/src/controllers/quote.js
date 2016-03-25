'use strict'

const model = require('../models/quote')

/* eslint-disable */
/**
 * @api {get} /quote Get quote
 *
 * @apiName Quote
 * @apiGroup Quote
 *
 * @apiParam {URI} source_ledger Ledger where the transfer crediting the
 *    connector's account will take place
 * @apiParam {URI} destination_ledger Ledger where the transfer debiting the
 *    connector's account will take place
 * @apiParam {Number} [source_amount="(Set by connector if destination_amount is
 *    specified)"] Fixed amount to be debited from sender's account
 *    (should not be specified if destination_amount is)
 * @apiParam {Number} [destination_amount="(Set by connector if source_amount is
 *    specified)"] Fixed amount to be credited to receiver's account
 *    (should not be specified if source_amount is)
 * @apiParam {Number} [destination_expiry_duration="(Maximum allowed if
 *    unspecified)"] Number of milliseconds between when the source transfer is
 *    proposed and when it expires
 * @apiParam {Number} [source_expiry_duration="(Minimum allowed based on
 *    destination_expiry_duration)"] Number of milliseconds between when the
 *    destination transfer is proposed and when it expires
 *
 * @apiDescription Get a quote from the connector based on either a fixed source
 *    or fixed destination amount.
 *
 * @apiExample {shell} Fixed Source Amount:
 *    curl https://connector.example? \
 *      source_amount=100.25 \
 *      &source_ledger=https://eur-ledger.example/EUR \
 *      &destination_ledger=https://usd-ledger.example/USD \
 *      &source_expiry_duration=6 \
 *      &destination_expiry_duration=5 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_transfers": [
 *          {
 *            "ledger": "http://eur-ledger.example/EUR",
 *            "credits": [
 *              {
 *                "account": "mark",
 *                "amount": "100.25"
 *              }
 *            ],
 *            "expiry_duration": "6000"
 *          }
 *        ],
 *        "destination_transfers": [
 *          {
 *            "ledger": "http://usd-ledger.example/USD",
 *            "debits": [
 *              {
 *                "amount": "105.71",
 *                "account": "mark"
 *              }
 *            ],
 *            "expiry_duration": "5000"
 *          }
 *        ]
 *      }
 *
 * @apiExample {shell} Fixed Destination Amount:
 *    curl https://connector.example? \
 *      destination_amount=105.71 \
 *      &source_ledger=https://eur-ledger.example/EUR \
 *      &destination_ledger=https://usd-ledger.example/USD \
 *      &source_expiry_duration=6000 \
 *      &destination_expiry_duration=5000 \
 *
 * @apiSuccessExample {json} 200 Quote Response:
 *    HTTP/1.1 200 OK
 *      {
 *        "source_transfers": [
 *          {
 *            "ledger": "http://eur-ledger.example/EUR",
 *            "credits": [
 *              {
 *                "account": "mark",
 *                "amount": "100.25"
 *              }
 *            ],
 *            "expiry_duration": "6000"
 *          }
 *        ],
 *        "destination_transfers": [
 *          {
 *            "ledger": "http://usd-ledger.example/USD",
 *            "debits": [
 *              {
 *                "amount": "105.71",
 *                "account": "mark"
 *              }
 *            ],
 *            "expiry_duration": "5000"
 *          }
 *        ]
 *      }
 *
 * @apiUse UnacceptableExpiryError
 * @apiUse AssetsNotTradedError
 */
/* eslint-enable */

exports.get = function * () {
  this.body = yield model.getQuote(
    this.query, this.ledgers, this.config)
}

