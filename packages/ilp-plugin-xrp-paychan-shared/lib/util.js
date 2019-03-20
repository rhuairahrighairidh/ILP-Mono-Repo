'use strict'

const debug = require('debug')('ilp-plugin-xrp:util')
const BigNumber = require('bignumber.js')
const crypto = require('crypto')
const addressCodec = require('ripple-address-codec')

const INFO_REQUEST_ALL = 2
const MIN_SETTLE_DELAY = 3600
const DEFAULT_CLAIM_INTERVAL = 5 * 60 * 1000

const MAX_U32 = '4294967296'
const MAX_U64 = '18446744073709551616'
const VALID_XRP_REGEX = /^([1-9][0-9]{0,16})$|^100000000000000000$/

const DROPS_PER_XRP = 1000000
const dropsToXrp = (drops) => new BigNumber(drops).div(DROPS_PER_XRP).toString()
const xrpToDrops = (xrp) => new BigNumber(xrp).mul(DROPS_PER_XRP).toString()

function hmac (key, message) {
  const h = crypto.createHmac('sha256', key)
  h.update(message)
  return h.digest()
}

function toU32BE (n) {
  const bn = new BigNumber(n)
  if (bn.lt('0') || bn.gte(MAX_U32)) {
    throw new Error('number out of range for u32. n=' + n)
  }

  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(bn.toNumber(), 0)
  return buf
}

function toU64BE (n) {
  const bn = new BigNumber(n)
  if (bn.lt('0') || bn.gte(MAX_U64)) {
    throw new Error('number out of range for u64. n=' + n)
  }

  const buf = Buffer.alloc(8)
  const high = bn.dividedBy(MAX_U32)
  const low = bn.modulo(MAX_U32)
  buf.writeUInt32BE(high.toNumber(), 0)
  buf.writeUInt32BE(low.toNumber(), 4)
  return buf
}

function fromU32BE (buf) {
  return new BigNumber(buf.readUInt32BE(0))
}

function computeChannelId (src, dest, sequence) {
  const preimage = Buffer.concat([
    Buffer.from('\0x', 'ascii'),
    Buffer.from(addressCodec.decodeAccountID(src)),
    Buffer.from(addressCodec.decodeAccountID(dest)),
    toU32BE(sequence)
  ])

  return crypto.createHash('sha512')
    .update(preimage)
    .digest()
    .slice(0, 32) // first half sha512
    .toString('hex')
    .toUpperCase()
}

function encodeClaim (amount, id) {
  if (!VALID_XRP_REGEX.test(amount)) {
    throw new Error('amount is not a valid xrp amount. amount=' + amount)
  }

  return Buffer.concat([
    Buffer.from('CLM\0'),
    Buffer.from(id, 'hex'),
    toU64BE(amount)
  ])
}

function randomTag () {
  return fromU32BE(crypto.randomBytes(4)).toNumber()
}

async function _requestId () {
  return new Promise((resolve, reject) => {
    crypto.randomBytes(4, (err, buf) => {
      if (err) reject(err)
      resolve(buf.readUInt32BE(0))
    })
  })
}

async function fundChannel ({ api, channel, amount, address, secret }) {
  debug('preparing fund tx')
  const xrpAmount = dropsToXrp(amount)
  const tx = await api.preparePaymentChannelFund(address, {
    amount: xrpAmount,
    channel
  })

  debug('submitting fund tx')
  const signedTx = api.sign(tx.txJSON, secret)
  const { resultCode, resultMessage } = await api.submit(signedTx.signedTransaction)

  debug('got fund submit result', resultCode)
  if (resultCode !== 'tesSUCCESS') {
    debug('unable to fund channel:', resultCode, resultMessage)
    throw new Error('unable to fund channel: ' + resultCode + ' ' + resultMessage)
  }

  return new Promise((resolve, reject) => {
    async function handleTransaction (ev) {
      if (ev.transaction.hash !== signedTx.id) return
      if (ev.engine_result !== 'tesSUCCESS') {
        debug('failed fund tx:', ev)
        reject(new Error('failed fund tx: ' + JSON.stringify(ev)))
      }

      debug('funded channel')
      setImmediate(() => api.connection
        .removeListener('transaction', handleTransaction))

      resolve()
    }

    api.connection.on('transaction', handleTransaction)
  })
}

function encodeChannelProof (channel, account) {
  return Buffer.concat([
    Buffer.from('channel_signature'),
    Buffer.from(channel, 'hex'),
    Buffer.from(account, 'base64')
  ])
}

module.exports = {
  INFO_REQUEST_ALL,
  MIN_SETTLE_DELAY,
  DEFAULT_CLAIM_INTERVAL,
  DROPS_PER_XRP,
  dropsToXrp,
  xrpToDrops,
  toU32BE,
  toU64BE,
  fromU32BE,
  hmac,
  computeChannelId,
  encodeClaim,
  randomTag,
  _requestId,
  fundChannel,
  encodeChannelProof
}
