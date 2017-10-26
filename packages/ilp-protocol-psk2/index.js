const crypto = require('crypto')
const IlpPacket = require('ilp-packet')
const oer = require('oer-utils')
const uuid = require('uuid')
const cryptoHelper = require('./crypto')
const base64url = require('./base64url')
const BigNumber = require('bignumber.js')
const Long = require('long')
const debug = require('debug')('ilp:psk2')

const NULL_CONDITION = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DEFAULT_TRANSFER_TIMEOUT = 30
// TODO what is a reasonable timeout if we're sending multiple payment chunks?
const DEFAULT_PAYMENT_TIMEOUT = 120
// TODO what is a reasonable transfer amount to start?
const DEFAULT_TRANSFER_START_AMOUNT = 1000
const PAYMENT_SIZE_INCREASE_FACTOR = 1.1
const PAYMENT_SIZE_DECREASE_FACTOR = 0.5
const MS_TO_WAIT_AFTER_EXPIRY_BEFORE_REFUND = 30000
const MINIMUM_AMOUNT_FOR_REFUND = 100

// TODO add rate cache
async function quoteBySourceAmount (plugin, {
  timeout,
  connector
}, {
  destinationAccount,
  sourceAmount,
  sharedSecret
}) {
  const firstConnector = connector || (plugin.getInfo().connectors && plugin.getInfo().connectors[0])
  const timeoutMilliseconds = (timeout || DEFAULT_TRANSFER_TIMEOUT) * 1000
  const packetData = Buffer.from(JSON.stringify({method: 'quote'}), 'utf8')
  const quoteTransfer = {
    id: uuid(),
    from: plugin.getAccount(),
    to: firstConnector,
    ledger: plugin.getInfo().prefix,
    amount: sourceAmount,
    ilp: base64url(IlpPacket.serializeIlpPayment({
      account: destinationAccount,
      amount: '0',
      data: packetData
    })),
    executionCondition: NULL_CONDITION,
    expiresAt: new Date(Date.now() + timeoutMilliseconds).toISOString()
  }
  debug('sending quote transfer:', quoteTransfer)

  const quoteTransferPromise = new Promise((resolve, reject) => {
    plugin.on('outgoing_reject', listener)
    // TODO don't add a new listener for every quote
    function listener (transfer, rejectionReason) {
      if (transfer.id === quoteTransfer.id) {
        plugin.removeListener('outgoing_reject', listener)
        resolve(rejectionReason.message)
      }
    }
    setTimeout(() => {
      reject(new Error('Quote timed out'))
    }, timeoutMilliseconds)
  })

  await plugin.sendTransfer(quoteTransfer)

  const rejectionMessage = await quoteTransferPromise

  // TODO make error messages binary
  // TODO encrypt response
  const destinationAmount = rejectionMessage
  return destinationAmount
}

async function sendByDestinationAmount (plugin, {
  timeout,
  connector
}, {
  destinationAccount,
  destinationAmount,
  maxSourceAmount,
  sharedSecret,
  paymentId
}) {
  const result = await _sendPayment(plugin, {
    timeout,
    connector
  }, {
    destinationAccount,
    destinationAmount,
    sourceAmount: maxSourceAmount,
    sharedSecret,
    id: paymentId
  })
  return result
}

async function sendBySourceAmount (plugin, {
  timeout,
  connector
}, {
  destinationAccount,
  sourceAmount,
  sharedSecret,
  paymentId
}) {
  const result = await _sendPayment(plugin, {
    timeout,
    connector
  }, {
    destinationAccount,
    sourceAmount,
    sharedSecret,
    id: paymentId
  })
  return result
}

// Send a specific source amount or deliver a destination amount.
// If both sourceAmount and destinationAmount are specified, it
// will try to deliver the destinationAmount without going over the sourceAmount
async function _sendPayment (plugin, {
  connector
}, {
  destinationAccount,
  destinationAmount,
  sourceAmount,
  sharedSecret,
  id
}) {
  // TODO send data along with payment?
  // TODO add option to fail instead of chunking payment
  // TODO add cache for destinations and max payment sizes

  const paymentId = id || uuid()
  debug(`sending new payment ${paymentId} to ${destinationAccount}. destinationAmount: ${destinationAmount}, sourceAmount: ${sourceAmount}`)

  // TODO make refund account suffix indistinguishable from receiver address
  const refundAccount = plugin.getAccount() + '.' + crypto.randomBytes(24).toString('base64')
  debug(`generated refund account: ${refundAccount}`)

  // TODO (more complicated) send through multiple connectors if there are multiple
  const firstConnector = connector || (plugin.getInfo().connectors && plugin.getInfo().connectors[0])

  // TODO should the per-transfer timeout be configurable?
  const transferTimeout = DEFAULT_TRANSFER_TIMEOUT * 1000

  // TODO if sourceAmount and destinationAmount are set, do an informational quote
  // first to see if we're likely to be able to complete the payment

  let amountSent = new BigNumber(0)
  let amountDelivered = new BigNumber(0)
  let numChunks = 0
  const startTime = Date.now()

  async function sendChunksAdjustingAmount () {
    // Start sending chunks using a default amount, then adjust it upwards or downwards
    let transferAmount = new BigNumber(DEFAULT_TRANSFER_START_AMOUNT)
    let maximumTransferAmount

    // Keep sending payments until we've reached the desired destination amount
    while (true) {
      // TODO don't send these details on every packet, only first one
      const paymentDetails = {
        method: 'pay',
        paymentId,
        destinationAmount,
        lastPayment: false,
        sourceAccount: refundAccount,
        nonce: base64url(crypto.randomBytes(16))
      }

      // Figure out if we've already sent enough or if we're close to the end
      if (destinationAmount) {
        if (amountDelivered.greaterThanOrEqualTo(destinationAmount)) {
          return
        }
        // TODO should we use the overall rate or the last chunk's rate?
        const rate = amountDelivered.dividedBy(amountSent)
        const destinationAmountRemaining = new BigNumber(destinationAmount).minus(amountDelivered)
        const sourceAmountRemaining = destinationAmountRemaining.dividedBy(rate)
        if (sourceAmountRemaining.lessThanOrEqualTo(transferAmount)) {
          transferAmount = BigNumber.max(sourceAmountRemaining.round(0), 1)
        }

        if (sourceAmount && amountSent.plus(transferAmount).greaterThan(sourceAmount)) {
          debug(`sending another chunk for payment ${paymentId} would exceed source amount limit`)
          return listenForRefund()
        }
      } else {
        if (amountSent.greaterThanOrEqualTo(sourceAmount)) {
          return
        }
        const sourceAmountRemaining = new BigNumber(sourceAmount).minus(amountSent)
        if (sourceAmountRemaining.lessThanOrEqualTo(transferAmount)) {
          transferAmount = BigNumber.max(sourceAmountRemaining.round(0), 1)
          paymentDetails.lastPayment = true
        }
      }

      // TODO encrypt packet data
      const packetData = Buffer.from(JSON.stringify(paymentDetails), 'utf8')
      const packet = IlpPacket.serializeIlpPayment({
        account: destinationAccount,
        amount: '0',
        data: packetData
      })
      const transfer = {
        id: uuid(),
        from: plugin.getAccount(),
        to: firstConnector,
        ledger: plugin.getInfo().prefix,
        amount: transferAmount.toString(10),
        ilp: base64url(packet),
        executionCondition: cryptoHelper.packetToCondition(sharedSecret, packet),
        expiresAt: new Date(Date.now() + transferTimeout).toISOString()
      }

      debug(`sending transfer for payment ${paymentId}:`, transfer)

      const transferResultPromise = _waitForTransferResult(plugin, transfer.id)
      await plugin.sendTransfer(transfer)
      const result = await transferResultPromise
      // TODO response data should be encrypted
      debug('got chunk result', result)

      // Adjust transfer amount up or down based on whether it succeeded or failed
      if (result.fulfillment) {
        // sending succeeded
        amountDelivered = BigNumber.max(result.ilp, amountDelivered)
        amountSent = amountSent.plus(transfer.amount)
        numChunks++

        debug(`sent chunk for payment ${paymentId}. amount sent: ${amountSent.toString(10) + (sourceAmount ? ' (of ' + sourceAmount + ')' : '')}, amount delivered: ${amountDelivered.toString(10) + (destinationAmount ? ' (of ' + destinationAmount + ')' : '')} (rate: ${amountDelivered.dividedBy(amountSent).toString(10)})`)

        // Increase the transfer amount as long as it doesn't go over the path's Maximum Payment Size
        const potentialTransferAmount = transferAmount.times(PAYMENT_SIZE_INCREASE_FACTOR).truncated()
        if (!maximumTransferAmount || potentialTransferAmount.lessThanOrEqualTo(maximumTransferAmount)) {
          debug(`increasing transfer amount by default factor`)
          transferAmount = potentialTransferAmount
        }
      } else {
        // sending failed
        // TODO handle if we don't get an error back
        const ilpError = IlpPacket.deserializeIlpError(Buffer.from(result.ilp || '', 'base64'))
        debug('sending chunk failed, got error:', ilpError)

        // TODO handle other types of errors (no liquidity, can't find receiver, payment already finished, etc)
        // TODO don't retry sending forever
        switch (ilpError.code) {
          case 'F08': // Payment Too Large
            // TODO handle if the error data doesn't contain the amount values
            const dataReader = oer.Reader.from(Buffer.from(ilpError.data, 'ascii'))
            const amountArrived = Long.fromBits.apply(null, dataReader.readUInt64().concat([true])).toString()
            const amountLimit = Long.fromBits.apply(null, dataReader.readUInt64().concat([true])).toString()
            let decreaseFactor = new BigNumber(amountLimit).dividedBy(amountArrived)
            if (decreaseFactor.greaterThanOrEqualTo(1)) {
              // something is wrong with the error values we got, use the default
              decreaseFactor = PAYMENT_SIZE_DECREASE_FACTOR
            }
            debug(`decreasing transfer amount by factor of: ${decreaseFactor.toString(10)}`)

            // the true path MPS might be lower than this but it definitely won't be higher
            // so this might get adjusted down more if we get more payment errors
            maximumTransferAmount = BigNumber.max(transferAmount.times(decreaseFactor).truncated(), 1)
            transferAmount = maximumTransferAmount
            break
          case 'T04': // Insufficient Liquidity
            // TODO switch to a different path if we can
            // TODO should we wait a bit and try again or fail immediately?
            debug('path has insufficient liquidity')
            return listenForRefund()

            break
          default:
            // TODO is this the right default behavior? should we keep trying?
            debug('decreasing transfer amount by default factor')
            transferAmount = BigNumber.max(transferAmount.times(PAYMENT_SIZE_DECREASE_FACTOR).truncated(), 1)
            break
        }
      }
    }
  }

  async function listenForRefund () {
    debug(`waiting for refund for payment ${paymentId}`)

    let amountReturned = 0
    try {
      // TODO accept partial refund
      amountReturned = await listenForPayment(plugin, {
        sharedSecret,
        paymentId,
        // TODO how long should we wait for the refund?
        timeout: 10,
        destinationAccount: refundAccount,
        disableRefund: true
      })
      debug(`got refund for payment ${paymentId} of ${amountReturned}`)
    } catch (err) {
      debug(`error waiting for refund for payment ${paymentId}:`, err)
    }
    throw new Error(`Sending payment ${paymentId} failed. Amount not returned: ${amountSent.minus(amountReturned).toString(10)}`)
  }

  await sendChunksAdjustingAmount()

  debug(`sent payment ${paymentId}. delivered ${amountDelivered.toString(10)} to ${destinationAccount} with ${numChunks} chunks in ${Date.now() - startTime}ms`)
  return {
    sourceAmount: amountSent.toString(10),
    destinationAmount: amountDelivered.toString(10)
  }
}

// TODO don't set up and tear down listeners for every transfer
async function _waitForTransferResult (plugin, targetTransferId) {
  return new Promise((resolve, reject) => {
    function fulfillListener (transfer, fulfillment, ilp) {
      if (transfer.id === targetTransferId) {
        cleanup()
        resolve({
          fulfillment,
          ilp
        })
      }
    }

    function rejectListener (transfer, ilp) {
      if (transfer.id === targetTransferId) {
        cleanup()
        // TODO handle specific errors
        resolve({
          ilp
        })
      }
    }

    function cancelListener (transfer, cancellationReason) {
      if (transfer.id === targetTransferId) {
        cleanup()
        // TODO handle specific errors
        reject(new Error('transfer cancelled'))
      }
    }
    function cleanup () {
      plugin.removeListener('outgoing_fulfill', fulfillListener)
      plugin.removeListener('outgoing_reject', rejectListener)
      plugin.removeListener('outgoing_cancel', cancelListener)
    }
    plugin.on('outgoing_fulfill', fulfillListener)
    plugin.on('outgoing_reject', rejectListener)
    plugin.on('outgoing_cancel', cancelListener)
  })
}

function generateParams ({
  plugin,
  destinationAccount,
  receiverSecret
}) {
  const account = destinationAccount || plugin.getAccount()
  const { token, sharedSecret, receiverId } =
    cryptoHelper.generatePskParams(Buffer.from(receiverSecret, 'base64'))

  return {
    sharedSecret,
    destinationAccount: account + '.' + receiverId + token
  }
}

async function listenForPayment (plugin, { sharedSecret, paymentId, timeout, destinationAccount, disableRefund }) {
  debug(`listening for payment ${paymentId}`)
  const paymentPromise = new Promise((resolve, reject) => {
    const stopListening = listen(plugin, {
      sharedSecret,
      destinationAccount,
      disableRefund
    }, async (payment) => {
      if (payment.id === paymentId) {
        const amountReceived = await payment.accept()
        resolve(amountReceived)
        stopListening()
      }
    })
  })

  // TODO what if we've already gotten some of the money but not all?
  let timer
  const timeoutPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      debug(`timed out waiting for payment ${paymentId}`)
      reject(new Error('timed out waiting for payment ' + paymentId))
    }, (timeout || DEFAULT_PAYMENT_TIMEOUT) * 1000)
  })

  const result = await Promise.race([paymentPromise, timeoutPromise])
  clearTimeout(timer)
  return result
}

// TODO add option to allow partial payments
function listen (plugin, { receiverSecret, sharedSecret, destinationAccount, disableRefund }, handler) {
  const payments = {}

  async function listener (transfer) {
    debug('got incoming transfer', transfer)
    const packet = IlpPacket.deserializeIlpPayment(Buffer.from(transfer.ilp, 'base64'))

    if (destinationAccount && packet.account !== destinationAccount) {
      debug(`transfer does not concern us. destination account: ${packet.account}, our account: ${destinationAccount}`)
      return
    }

    const data = JSON.parse(Buffer.from(packet.data, 'base64').toString('utf8'))
    debug('parsed data', data)

    // TODO handle if we can't regenerate the shared secret (means the payment isn't for us)
    sharedSecret = (sharedSecret && Buffer.from(sharedSecret, 'base64')) ||
      _accountToSharedSecret({
        account: packet.account,
        pluginAccount: plugin.getAccount(),
        receiverSecret
      })

    // TODO the fact that it's a quote should probably be communicated in headers
    if (data.method === 'quote') {
      debug('got incoming quote request')
      // TODO errors should be binary
      plugin.rejectIncomingTransfer(transfer.id, {
        code: 'F99',
        name: 'Application Error',
        message: transfer.amount
      })
      // TODO handle error rejecting transfer
    } else if (data.method === 'pay') {
      debug('got incoming payment chunk')
      const paymentId = data.paymentId
      if (!payments[paymentId]) {
        payments[paymentId] = {
          received: new BigNumber(0),
          expected: data.destinationAmount && new BigNumber(data.destinationAmount),
          receivedLastChunk: data.lastPayment,
          sourceAccount: data.sourceAccount,
          sharedSecret,
          accepted: null,
          rejectionReason: null,
          resolve: null,
          reject: null,
          refundTimout: null,
          longestDelayBetweenChunks: 1000, // wait at least 1 second
          lastChunkTimestamp: Date.now()
        }

        // TODO include data in callback
        handler({
          id: paymentId,
          amount: data.destinationAmount,
          // Receiver calls accept to start accepting chunks. It returns a promise that resolves
          // when the payment has been fully received or rejects if there is an error
          accept: () => {
            debug(`receiver accepted payment ${paymentId}`)
            payments[paymentId].accepted = true
            return new Promise((resolve, reject) => {
              payments[paymentId].resolve = resolve
              payments[paymentId].reject = reject
              finalizeTransfer(paymentId, transfer, data)
            })
          },
          reject: (reason) => {
            debug(`receiver rejected payment ${paymentId} with reason: ${reason}`)
            payments[paymentId].accepted = false
            payments[paymentId].rejectionReason = reason
            return finalizeTransfer(paymentId, transfer, data)
          }
        })
      } else {
        await finalizeTransfer(paymentId, transfer, data)
      }
    }
  }

  async function finalizeTransfer (paymentId, transfer, paymentData) {
    // TODO handle if other payments come in while we're still waiting for the receiver to accept or reject
    const paymentRecord = payments[paymentId]

    if (!paymentRecord.accepted) {
      // TODO errors should be binary
      await plugin.rejectIncomingTransfer(transfer.id, {
        code: 'F99',
        name: 'Application Error',
        message: paymentRecord.rejectionReason
      })
      // TODO handle error
      return
    }

    if (paymentRecord.receivedLastChunk || (!!paymentRecord.expected && paymentRecord.received.greaterThanOrEqualTo(paymentRecord.expected))) {
      // TODO errors should be binary
      await plugin.rejectIncomingTransfer(transfer.id, {
        code: 'F07',
        name: 'Cannot Receive',
        message: 'Payment already finished'
      })
      // TODO handle error
      return
    }

    const newPaymentAmount = paymentRecord.received.plus(transfer.amount)
    const fulfillment = cryptoHelper.packetToPreimage(transfer.ilp, paymentRecord.sharedSecret)
    // TODO encrypt fulfillment data
    await plugin.fulfillCondition(transfer.id, fulfillment, newPaymentAmount.toString(10))
    // TODO catch error
    payments[paymentId].received = newPaymentAmount
    if (paymentData.lastPayment === true) {
      debug(`received last chunk for payment ${paymentId}`)
      paymentRecord.receivedLastChunk = true
    }
    debug(`received chunk for payment ${paymentId}; total received: ${newPaymentAmount.toString(10)}`)

    // Notify the receiver if this chunk was the last one
    if (paymentRecord.expected && newPaymentAmount.greaterThanOrEqualTo(paymentRecord.expected)) {
      paymentRecord.resolve(newPaymentAmount.toString(10))
      clearTimeout(paymentRecord.refundTimeout)
    }

    if (!disableRefund) {
      // Update the refund timeout
      // Set it to 2x the default transfer timeout if this is the first chunk
      // or 2x the longest delay between chunks we've seen if not
      // TODO should we use a moving average to determine the max time we should wait for the next chunk?
      const delaySinceLastChunk = Date.now() - paymentRecord.lastChunkTimestamp
      paymentRecord.lastChunkTimestamp = Date.now()
      if (paymentRecord.refundTimeout === null) {
        paymentRecord.longestDelayBetweenChunks = delaySinceLastChunk
        paymentRecord.refundTimeout = setTimeout(() => {
          refundPayment(paymentId)
        }, DEFAULT_TRANSFER_TIMEOUT * 1000 * 2)
      } else {
        if (delaySinceLastChunk > paymentRecord.longestDelayBetweenChunks) {
          paymentRecord.longestDelayBetweenChunks = delaySinceLastChunk
        }
        clearTimeout(paymentRecord.refundTimeout)
        paymentRecord.refundTimeout = setTimeout(() => {
          refundPayment(paymentId)
        }, paymentRecord.longestDelayBetweenChunks * 2)
      }
    }
  }

  // TODO should there be an option to not issue refunds?
  async function refundPayment (paymentId) {
    const paymentRecord = payments[paymentId]
    paymentRecord.accepted = false
    paymentRecord.rejectionReason = 'Refunding payment'

    if (!paymentRecord.sourceAccount) {
      debug(`refund for payment ${paymentId} failed because it did not include a sourceAccount`)
      return
    }

    if (paymentRecord.received.lessThan(MINIMUM_AMOUNT_FOR_REFUND)) {
      debug(`refund for payment ${paymentId} cancelled because amount was too small (only received: ${paymentRecord.received.toString(10)})`)
      return
    }

    debug(`sending refund for payment ${paymentId}. source amount: ${paymentRecord.received.toString(10)})`)
    await sendBySourceAmount(plugin, {
    }, {
      destinationAccount: paymentRecord.sourceAccount,
      sourceAmount: paymentRecord.received,
      sharedSecret: paymentRecord.sharedSecret,
      paymentId
    })
  }

  plugin.on('incoming_prepare', listener)

  return () => {
    plugin.removeListener('incoming_prepare', listener)
  }
}

function _accountToSharedSecret ({ account, pluginAccount, receiverSecret }) {
  const localPart = account.slice(pluginAccount.length + 1)
  const receiverId = base64url(cryptoHelper.getReceiverId(receiverSecret))
  const token = Buffer.from(localPart.slice(receiverId.length), 'base64')

  return cryptoHelper.getPskSharedSecret(receiverSecret, token)
}

exports.generateParams = generateParams
exports.listen = listen
exports.quoteBySourceAmount = quoteBySourceAmount
exports.sendByDestinationAmount = sendByDestinationAmount
exports.sendBySourceAmount = sendBySourceAmount
