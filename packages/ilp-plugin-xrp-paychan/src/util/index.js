'use strict'

const bignum = require('bignum')
const crypto = require('crypto')
const addressCodec = require('ripple-address-codec')

function channelId (src, dest, sequence) {
  
  const hash = crypto.createHash('sha512')

  hash.update(Buffer.from('x', 'ascii'))
  hash.update(Buffer.from(addressCodec.decodeAccountID(src)))
  hash.update(Buffer.from(addressCodec.decodeAccountID(dest)))
  hash.update(bignum(sequence).toBuffer({ endian: 'big', size: 4 }))

  return hash
    .digest()
    .slice(0, 32) // first half sha512
    .toString('hex')
    .toUpperCase()
}

function randomTag (src, dest, sequence) {
  return +bignum.fromBuffer(crypto.randomBytes(4), {
    endian: 'big',
    size: 4
  }).toString()
}

//const omit = (obj, field) => Object.assign({}, obj, { [field]: undefined })
const sha256 = (m) => crypto.createHash('sha256').update(m, 'utf8').digest()

const toBuffer = (bn, size) => bignum(bn.round().toString()).toBuffer({
  endian: 'big',
  size: size
})

module.exports = {
  toBuffer,
  randomTag,
  sha256,
  channelId
}
