import Predictor from '../src/lib/predictor'
import Writer from '../src/lib/writer'
import BigNumber from 'bignumber.js'

import chai = require('chai')
const assert = chai.assert

const MAX_SAFE_INTEGER = 9007199254740991

describe('Predictor', function () {
  describe('constructor', function () {
    it('should create a Predictor', function () {
      const predictor = new Predictor()

      assert.instanceOf(predictor, Predictor)
    })
  })

  describe('Writer API', function () {
    it('should have the same API as the Writer', function () {
      const predictor = new Predictor()
      const writer = new Writer()

      for (let method of Object.getOwnPropertyNames(Object.getPrototypeOf(writer))) {
        if (method.startsWith('write')) {
          assert.typeOf(predictor[method], 'function', `Expected predictor to have ${method} method`)
        }
      }
    })

    it('a function that takes a Writer should accept the Predictor instead', function () {
      function writeSomeStuff (writer: Writer) {
        writer.writeUInt8(0)
        writer.writeVarOctetString(Buffer.alloc(10))
      }

      const predictor = new Predictor()
      writeSomeStuff(predictor)
    })
  })

  describe('writeUInt', function () {
    it('should increment by the length of the unsigned integer', function () {
      const predictor = new Predictor()

      predictor.writeUInt(0, 1)

      assert.equal(predictor.getSize(), 1)
    })

    it('should increment multiple times for multiple integers', function () {
      const predictor = new Predictor()

      predictor.writeUInt(0, 1)
      predictor.writeUInt(0, 4)

      assert.equal(predictor.getSize(), 5)
    })
  })

  describe('writeInt', function () {
    it('should increment by the length of the integer', function () {
      const predictor = new Predictor()

      predictor.writeInt(-1, 1)

      assert.equal(predictor.getSize(), 1)
    })

    it('should increment multiple times for multiple integers', function () {
      const predictor = new Predictor()

      predictor.writeUInt(-10, 1)
      predictor.writeUInt(-400, 4)

      assert.equal(predictor.getSize(), 5)
    })
  })

  describe('writeVarUInt', function () {
    it('should accept a BigNumber and add the correct size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(new BigNumber('10'.repeat(10), 16))

      assert.equal(predictor.getSize(), 11)
    })

    it('should accept zero and add 2 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(0)

      assert.equal(predictor.getSize(), 2)
    })

    it('should accept 0x01020304 and add 5 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(0x01020304)

      assert.equal(predictor.getSize(), 5)
    })

    it('should accept MAX_SAFE_INTEGER and add 8 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeVarUInt(MAX_SAFE_INTEGER)

      assert.equal(predictor.getSize(), 8)
    })

    it('when writing a non-integer, should throw', function () {
      const predictor = new Predictor()

      assert.throws(
        () => predictor.writeVarUInt(0.5),
        'UInt must be an integer'
      )
    })

    it('when writing a negative integer, should throw', function () {
      const predictor = new Predictor()

      assert.throws(
        () => predictor.writeVarUInt(-1),
        'UInt must be positive'
      )
    })
  })

  describe('writeVarInt', function () {
    it('should accept a BigNumber and add the correct size', function () {
      const predictor = new Predictor()

      predictor.writeVarInt(new BigNumber('10'.repeat(10), 16))

      assert.equal(predictor.getSize(), 11)
    })

    it('should accept a negative number and add the correct size', function () {
      const predictor = new Predictor()

      predictor.writeVarInt(new BigNumber('-' + '10'.repeat(10), 16))

      assert.equal(predictor.getSize(), 12)
    })

    it('when writing a non-integer, should throw', function () {
      const predictor = new Predictor()

      assert.throws(
        () => predictor.writeVarInt(0.5),
        'UInt must be an integer'
      )
    })
  })

  describe('writeOctetString', function () {
    it('should increment by the given length of the octet string', function () {
      const predictor = new Predictor()

      predictor.writeOctetString(new Buffer(10), 5)

      assert.equal(predictor.getSize(), 5)
    })
  })

  describe('writeVarOctetString', function () {
    it('should calculate the correct length for an empty buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(0))

      assert.equal(predictor.getSize(), 1)
    })

    it('should calculate the correct length for a short buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(10))

      assert.equal(predictor.getSize(), 11)
    })

    it('should calculate the correct length for a long buffer', function () {
      const predictor = new Predictor()

      predictor.writeVarOctetString(new Buffer(256))

      assert.equal(predictor.getSize(), 259)
    })
  })

  describe('prependLengthPrefix', function () {
    it('should calculate the correct length for an empty buffer', function () {
      const predictor = new Predictor()

      predictor.prependLengthPrefix()

      assert.equal(predictor.getSize(), 1)
    })

    it('should calculate the correct length for a short buffer', function () {
      const predictor = new Predictor()

      predictor.write(Buffer.alloc(10))
      predictor.prependLengthPrefix()

      assert.equal(predictor.getSize(), 11)
    })

    it('should calculate the correct length for a long buffer', function () {
      const predictor = new Predictor()

      predictor.write(Buffer.alloc(256))
      predictor.prependLengthPrefix()

      assert.equal(predictor.getSize(), 259)
    })
  })

  describe('write', function () {
    it('should add the size of the buffer to the total size', function () {
      const predictor = new Predictor()

      predictor.write(new Buffer(15))

      assert.equal(predictor.getSize(), 15)
    })
  })

  describe('skip', function () {
    it('should add the given number of bytes to the total size', function () {
      const predictor = new Predictor()

      predictor.skip(15)

      assert.equal(predictor.getSize(), 15)
    })
  })

  describe('writeUInt8', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt8(15)

      assert.equal(predictor.getSize(), 1)
    })
  })

  describe('writeUInt16', function () {
    it('should add 2 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt16(15)

      assert.equal(predictor.getSize(), 2)
    })
  })

  describe('writeUInt32', function () {
    it('should add 4 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt32(15)

      assert.equal(predictor.getSize(), 4)
    })
  })

  describe('writeUInt64', function () {
    it('should add 8 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeUInt64(15)

      assert.equal(predictor.getSize(), 8)
    })
  })

  describe('writeInt8', function () {
    it('should add 1 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeInt8(15)

      assert.equal(predictor.getSize(), 1)
    })
  })

  describe('writeInt16', function () {
    it('should add 2 byte to the size', function () {
      const predictor = new Predictor()

      predictor.writeInt16(15)

      assert.equal(predictor.getSize(), 2)
    })
  })

  describe('writeInt32', function () {
    it('should add 4 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeInt32(15)

      assert.equal(predictor.getSize(), 4)
    })
  })

  describe('writeInt64', function () {
    it('should add 8 bytes to the size', function () {
      const predictor = new Predictor()

      predictor.writeInt64(15)

      assert.equal(predictor.getSize(), 8)
    })
  })

  describe('getBuffer', function () {
    it('should return a dummy empty buffer', function () {
      const predictor = new Predictor()

      predictor.write(Buffer.alloc(10))

      const buffer = predictor.getBuffer()

      assert(Buffer.isBuffer(buffer))
      assert.equal(predictor.getSize(), 10)
    })
  })
})
