import 'mocha'
import * as sinon from 'sinon'
import { assert } from 'chai'
import * as crypto from 'crypto'
import mock = require('mock-require')
import BigNumber from 'bignumber.js'
import * as IlpPacket from 'ilp-packet'
import MockPlugin from './mocks/plugin'
import { Receiver, createReceiver, PaymentReceived, PaymentHandlerParams } from '../src/receiver'
import * as encoding from '../src/encoding'
import * as ILDCP from 'ilp-protocol-ildcp'
import { MAX_UINT64 } from '../src/constants'
import * as condition from '../src/condition'

describe('Receiver', function () {
  beforeEach(function () {
    this.plugin = new MockPlugin(0.5)
    this.ildcpStub = sinon.stub(this.plugin, 'sendData')
      .onFirstCall()
      .resolves(ILDCP.serializeIldcpResponse({
        clientAddress: 'test.receiver',
        assetScale: 9,
        assetCode: 'ABC'
      }))
      .callThrough()
    this.receiver = new Receiver(this.plugin, Buffer.alloc(32))
  })

  describe('connect', function () {
    it('should connect the plugin', async function () {
      const spy = sinon.spy(this.plugin, 'connect')
      await this.receiver.connect()
      assert(spy.called)
    })

    it('should use ILDCP to get the receiver ILP address', async function () {
      await this.receiver.connect()
      assert(this.ildcpStub.called)
      // This will throw if it can't parse it
      ILDCP.deserializeIldcpRequest(this.ildcpStub.args[0][0])
    })
  })

  describe('disconnect', function () {
    it('should disconnect the plugin and deregister the data handler', async function () {
      const disconnect = sinon.spy(this.plugin, 'disconnect')
      const deregister = sinon.spy(this.plugin, 'deregisterDataHandler')
      await this.receiver.disconnect()
      assert(disconnect.called)
      assert(deregister.called)
    })
  })

  describe('generateAddressAndSecret', function () {
    it('should throw if the receiver is not connected', function () {
      try {
        this.receiver.generateAddressAndSecret()
      } catch (err) {
        assert.equal(err.message, 'Receiver must be connected')
        return
      }
      assert(false, 'should not get here')
    })

    it('should append the receiver ID and token to the address returned by ILDCP', async function () {
      await this.receiver.connect()
      const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
      assert.match(destinationAccount, /^test\.receiver\.-2ZDreU6l9g\.[a-zA-Z0-9_-]+$/)
    })

    it('should create a unique shared secret every time it is called', async function () {
      await this.receiver.connect()
      const call1 = this.receiver.generateAddressAndSecret()
      const call2 = this.receiver.generateAddressAndSecret()
      assert.notEqual(call1.destinationAccount, call2.destinationAccount)
      assert.notEqual(call1.sharedSecret, call2.sharedSecret)
    })
  })

  describe('handleData', function () {
    beforeEach(async function () {
      await this.receiver.connect()
    })

    describe('invalid packets', function () {
      it('should reject if it gets anything other than an IlpPrepare packet', async function () {
        const response = await this.plugin.sendData(IlpPacket.serializeIlpForwardedPayment({
          account: 'test.receiver',
          data: Buffer.alloc(32)
        }))
        assert(response)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F06',
          message: 'Payment is not for this receiver',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject if the receiver ID does not match', async function () {
        const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: 'test.receiver.abc12345.sdflkjlskdfj',
          amount: '1',
          expiresAt: new Date(2000),
          executionCondition: Buffer.alloc(32),
          data: Buffer.alloc(32)
        }))
        assert(response)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F06',
          message: 'Payment is not for this receiver',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject if it cannot decrypt the data', async function () {
        const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
        const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: destinationAccount,
          amount: '1',
          expiresAt: new Date(2000),
          executionCondition: Buffer.alloc(32),
          data: Buffer.alloc(32)
        }))
        assert(response)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F06',
          message: 'Unable to parse data',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject if it does not know the PSK packet type', async function () {
        const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
        const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: destinationAccount,
          amount: '1',
          expiresAt: new Date(2000),
          executionCondition: Buffer.alloc(32),
          data: encoding.serializePskPacket(sharedSecret, {
            type: 4,
            paymentId: Buffer.alloc(16),
            sequence: 0,
            paymentAmount: MAX_UINT64,
            chunkAmount: MAX_UINT64,
            applicationData: Buffer.alloc(0)
          })
        }))
        assert(response)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F06',
          message: 'Unexpected request type',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject if the prepare amount is lower than the chunk amount specified in the PSK data (and the response should say how much arrived)', async function () {
        const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
        const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: destinationAccount,
          amount: '100',
          expiresAt: new Date(2000),
          executionCondition: Buffer.alloc(32),
          data: encoding.serializePskPacket(sharedSecret, {
            type: 0,
            paymentId: Buffer.alloc(16),
            sequence: 0,
            paymentAmount: MAX_UINT64,
            chunkAmount: MAX_UINT64,
            applicationData: Buffer.alloc(0)
          })
        }))
        assert(response)
        const reject = IlpPacket.deserializeIlpReject(response)
        assert.equal(reject.code, 'F99')
        assert.equal(reject.message, '')
        const pskResponse = encoding.deserializePskPacket(sharedSecret, reject.data)
        assert.deepEqual(pskResponse, {
          type: 3,
          paymentId: Buffer.alloc(16),
          sequence: 0,
          paymentAmount: new BigNumber(0),
          chunkAmount: new BigNumber(50),
          applicationData: Buffer.alloc(0)
        })
      })

      it('should reject if it cannot regenerate the fulfillment from the PSK data', async function () {
        const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
        const response = await this.plugin.sendData(IlpPacket.serializeIlpPrepare({
          destination: destinationAccount,
          amount: '100',
          expiresAt: new Date(2000),
          executionCondition: Buffer.alloc(32),
          data: encoding.serializePskPacket(sharedSecret, {
            type: 0,
            paymentId: Buffer.alloc(16),
            sequence: 0,
            paymentAmount: MAX_UINT64,
            chunkAmount: new BigNumber(50),
            applicationData: Buffer.alloc(0)
          })
        }))
        assert(response)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F05',
          message: 'condition generated does not match prepare',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })
    })

    describe('valid one-off packets', function () {
      beforeEach(function () {
        const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
        const pskRequest = encoding.serializePskPacket(sharedSecret, {
          type: 1,
          paymentId: Buffer.alloc(16),
          sequence: 0,
          paymentAmount: MAX_UINT64,
          chunkAmount: new BigNumber(0),
          applicationData: Buffer.alloc(0)
        })
        this.fulfillment = condition.dataToFulfillment(sharedSecret, pskRequest)
        const executionCondition = condition.fulfillmentToCondition(this.fulfillment)
        this.prepare = IlpPacket.serializeIlpPrepare({
          destination: destinationAccount,
          amount: '100',
          expiresAt: new Date(Date.now() + 2000),
          executionCondition,
          data: pskRequest
        })
      })

      it('should fulfill a payment if the payment handler accepts it', async function () {
        this.receiver.registerPaymentHandler(async (params: PaymentHandlerParams) => {
          await params.accept()
        })
        const response = await this.plugin.sendData(this.prepare)

        assert.equal(response[0], IlpPacket.Type.TYPE_ILP_FULFILL)
        assert.deepEqual(IlpPacket.deserializeIlpFulfill(response).fulfillment, this.fulfillment)
      })

      it('should reject payments if the payment handler calls reject', async function () {
        this.receiver.registerPaymentHandler(async (params: PaymentHandlerParams) => {
          await params.reject('unwanted')
        })
        const response = await this.plugin.sendData(this.prepare)

        assert.equal(response[0], IlpPacket.Type.TYPE_ILP_REJECT)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F99',
          message: 'unwanted',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject payments if there is an error thrown in the payment handler', async function () {
        this.receiver.registerPaymentHandler(async (params: PaymentHandlerParams) => {
          throw new Error('some error')
        })
        const response = await this.plugin.sendData(this.prepare)

        assert.equal(response[0], IlpPacket.Type.TYPE_ILP_REJECT)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F99',
          message: 'some error',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject payments if the payment handler finishes without accept being called', async function () {
        this.receiver.registerPaymentHandler(async (params: PaymentHandlerParams) => {
          return
        })
        const response = await this.plugin.sendData(this.prepare)

        assert.equal(response[0], IlpPacket.Type.TYPE_ILP_REJECT)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F99',
          message: 'receiver did not accept the payment',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })

      it('should reject payments if there is no payment handler registered', async function () {
        this.receiver.deregisterPaymentHandler()
        const response = await this.plugin.sendData(this.prepare)

        assert.equal(response[0], IlpPacket.Type.TYPE_ILP_REJECT)
        assert.deepEqual(IlpPacket.deserializeIlpReject(response), {
          code: 'F99',
          message: 'Receiver has no payment handler registered',
          triggeredBy: 'test.receiver',
          data: Buffer.alloc(0)
        })
      })
    })
  })

  describe('multiple chunks', function () {
    beforeEach(async function () {
      await this.receiver.connect()
      const { destinationAccount, sharedSecret } = this.receiver.generateAddressAndSecret()
      this.destinationAccount = destinationAccount
      this.sharedSecret = sharedSecret
      const pskRequest1 = encoding.serializePskPacket(sharedSecret, {
        type: 0,
        paymentId: Buffer.alloc(16),
        sequence: 0,
        paymentAmount: new BigNumber(500),
        chunkAmount: new BigNumber(0),
        applicationData: Buffer.alloc(0)
      })
      const fulfillment1 = condition.dataToFulfillment(sharedSecret, pskRequest1)
      const executionCondition1 = condition.fulfillmentToCondition(fulfillment1)
      this.prepare1 = IlpPacket.serializeIlpPrepare({
        destination: destinationAccount,
        amount: '100',
        expiresAt: new Date(Date.now() + 2000),
        executionCondition: executionCondition1,
        data: pskRequest1
      })
      const pskRequest2 = encoding.serializePskPacket(sharedSecret, {
        type: 0,
        paymentId: Buffer.alloc(16),
        sequence: 1,
        paymentAmount: new BigNumber(500),
        chunkAmount: new BigNumber(0),
        applicationData: Buffer.alloc(0)
      })
      const fulfillment2 = condition.dataToFulfillment(sharedSecret, pskRequest2)
      const executionCondition2 = condition.fulfillmentToCondition(fulfillment2)
      this.prepare2 = IlpPacket.serializeIlpPrepare({
        destination: destinationAccount,
        amount: '200',
        expiresAt: new Date(Date.now() + 2000),
        executionCondition: executionCondition2,
        data: pskRequest2
      })
    })

    it('should call the payment handler on the first chunk', async function () {
      const spy = sinon.spy()
      this.receiver.registerPaymentHandler(spy)
      await this.plugin.sendData(this.prepare1)
      assert.typeOf(spy.args[0][0].accept, 'function')
      assert.typeOf(spy.args[0][0].reject, 'function')
      assert.typeOf(spy.args[0][0].acceptSingleChunk, 'function')
      assert.typeOf(spy.args[0][0].rejectSingleChunk, 'function')
      assert.typeOf(spy.args[0][0].prepare, 'object')
      assert.equal(spy.args[0][0].prepare.amount, '50')
      assert(Buffer.isBuffer(spy.args[0][0].id))
    })

    it('should accept the next chunks if the receiver calls accpet', async function () {
      const spy = sinon.spy()
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        params.accept()
        spy()
      })
      const result1 = await this.plugin.sendData(this.prepare1)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(spy.callCount, 1)
    })

    it('should resolve the Promise returned by the accept function when the payment has been fully received', async function () {
      const spy = sinon.spy()
      this.receiver.registerPaymentHandler(async (params: PaymentHandlerParams) => {
        const paymentResult = await params.accept()
        spy(paymentResult)
      })

      const pskRequest = encoding.serializePskPacket(this.sharedSecret, {
        type: 0,
        paymentId: Buffer.alloc(16),
        sequence: 2,
        paymentAmount: new BigNumber(500),
        chunkAmount: new BigNumber(0),
        applicationData: Buffer.alloc(0)
      })
      const fulfillment = condition.dataToFulfillment(this.sharedSecret, pskRequest)
      const executionCondition = condition.fulfillmentToCondition(fulfillment)
      const prepare3 = IlpPacket.serializeIlpPrepare({
        destination: this.destinationAccount,
        amount: '1002', // plugin applies 0.5 exchange rate
        expiresAt: new Date(Date.now() + 2000),
        executionCondition: executionCondition,
        data: pskRequest
      })

      const result1 = await this.plugin.sendData(this.prepare1)
      const result2 = await this.plugin.sendData(this.prepare2)
      const result3 = await this.plugin.sendData(prepare3)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result3[0], IlpPacket.Type.TYPE_ILP_FULFILL)

      // The payment result promise is resolved without being awaited so it'll only happen on the next tick of the event loop
      await new Promise((resolve, reject) => setImmediate(resolve))

      assert.equal(spy.callCount, 1)
      assert.deepEqual(spy.args[0][0], {
        id: Buffer.alloc(16),
        chunksFulfilled: 3,
        chunksRejected: 0,
        expectedAmount: '500',
        receivedAmount: '651'
      })
    })

    it('should reject all chunks if the receiver calls reject', async function () {
      const spy = sinon.spy()
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        spy()
        params.reject('nop')
      })
      const result1 = await this.plugin.sendData(this.prepare1)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_REJECT)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_REJECT)
      assert.equal(spy.callCount, 1)
    })

    it('should not accept any more chunks after the payment amount has been received', async function () {
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        params.accept()
      })
      const pskRequest = encoding.serializePskPacket(this.sharedSecret, {
        type: 0,
        paymentId: Buffer.alloc(16),
        sequence: 0,
        paymentAmount: new BigNumber(500),
        chunkAmount: new BigNumber(0),
        applicationData: Buffer.alloc(0)
      })
      const fulfillment = condition.dataToFulfillment(this.sharedSecret, pskRequest)
      const executionCondition = condition.fulfillmentToCondition(fulfillment)
      const prepare = IlpPacket.serializeIlpPrepare({
        destination: this.destinationAccount,
        amount: '1002', // plugin applies 0.5 exchange rate
        expiresAt: new Date(Date.now() + 2000),
        executionCondition: executionCondition,
        data: pskRequest
      })
      const result1 = await this.plugin.sendData(prepare)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_REJECT)
    })

    it('should not accept more chunks after the last chunk has been received', async function () {
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        params.accept()
      })
      const pskRequest = encoding.serializePskPacket(this.sharedSecret, {
        type: 1, // last chunk
        paymentId: Buffer.alloc(16),
        sequence: 0,
        paymentAmount: new BigNumber(500),
        chunkAmount: new BigNumber(0),
        applicationData: Buffer.alloc(0)
      })
      const fulfillment = condition.dataToFulfillment(this.sharedSecret, pskRequest)
      const executionCondition = condition.fulfillmentToCondition(fulfillment)
      const prepare = IlpPacket.serializeIlpPrepare({
        destination: this.destinationAccount,
        amount: '100',
        expiresAt: new Date(Date.now() + 2000),
        executionCondition: executionCondition,
        data: pskRequest
      })
      const result1 = await this.plugin.sendData(prepare)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_REJECT)
    })

    it('should accept one chunk and call the payment handler again if the user calls acceptSingleChunk', async function () {
      const spy = sinon.spy()
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        params.acceptSingleChunk()
        spy()
      })
      const result1 = await this.plugin.sendData(this.prepare1)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(spy.callCount, 2)
    })

    it('should reject one chunk and call the payment handler again if the user calls rejectSingleChunk', async function () {
      let callCount = 0
      this.receiver.registerPaymentHandler((params: PaymentHandlerParams) => {
        if (++callCount === 1) {
          params.rejectSingleChunk('nope')
        } else {
          params.acceptSingleChunk()
        }
      })
      const result1 = await this.plugin.sendData(this.prepare1)
      const result2 = await this.plugin.sendData(this.prepare2)

      assert.equal(result1[0], IlpPacket.Type.TYPE_ILP_REJECT)
      assert.equal(result2[0], IlpPacket.Type.TYPE_ILP_FULFILL)
      assert.equal(callCount, 2)
    })

    it.skip('should track payment ids separately for each token / sender')
  })
})

describe('createReceiver', function () {
  beforeEach(function () {
    this.plugin = new MockPlugin(0.5)
    this.ildcpStub = sinon.stub(this.plugin, 'sendData')
      .onFirstCall()
      .resolves(ILDCP.serializeIldcpResponse({
        clientAddress: 'test.receiver',
        assetScale: 9,
        assetCode: 'ABC'
      }))
  })

  it('should return a new, connected receiver with a random secret', async function () {
    const receiver = await createReceiver({
      plugin: this.plugin,
      paymentHandler: (params: PaymentHandlerParams) => params.accept().then(function () { return })
    })
    assert(this.plugin.isConnected())
    assert(receiver.isConnected())
    assert.notEqual(this.plugin.dataHandler, this.plugin.defaultDataHandler)
  })
})
