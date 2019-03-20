import Writer from '../src/lib/writer'
import BigNumber from 'bignumber.js'

import chai = require('chai')
const assert = chai.assert

const MAX_SAFE_INTEGER = 9007199254740991
const MIN_SAFE_INTEGER = -9007199254740991

describe('Writer', function () {
  describe('constructor', function () {
    it('should create a writer', function () {
      const writer = new Writer()

      assert.instanceOf(writer, Writer)
    })
  })

  describe('writeUInt', function () {
    it('when writing a zero byte integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt(0, 0),
        'UInt length must be greater than zero'
      )
    })

    it('should write a one byte integer zero', function () {
      const writer = new Writer()

      writer.writeUInt(0, 1)

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a one byte integer one', function () {
      const writer = new Writer()

      writer.writeUInt(1, 1)

      assert.equal(writer.getBuffer().toString('hex'), '01')
    })

    it('should write a one byte integer 255', function () {
      const writer = new Writer()

      writer.writeUInt(255, 1)

      assert.equal(writer.getBuffer().toString('hex'), 'ff')
    })

    it('should write a two byte integer', function () {
      const writer = new Writer()

      writer.writeUInt(258, 2)

      assert.equal(writer.getBuffer().toString('hex'), '0102')
    })

    it('when asked to write an integer that does not fit, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt(256, 1),
        'UInt 256 does not fit in 1 bytes'
      )
    })

    it('should write a BigNumber outside of safe JavaScript range', function () {
      const writer = new Writer()

      writer.writeUInt(0xff0203040506, 8)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('when asked to write an integer outside of safe JavaScript range, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt(MAX_SAFE_INTEGER + 1, 1),
        'UInt is larger than safe JavaScript range'
      )
    })

    it('when asked to write a negative integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt(-1, 1),
        'UInt must be positive'
      )
    })

    it('when asked to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt(false as any, 1),
        'UInt must be an integer'
      )
    })
  })

  describe('writeInt', function () {
    it('when writing a zero byte integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(0, 0),
        'Int length must be greater than zero'
      )
    })

    it('should write a one byte integer zero', function () {
      const writer = new Writer()

      writer.writeInt(0, 1)

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a one byte integer one', function () {
      const writer = new Writer()

      writer.writeInt(1, 1)

      assert.equal(writer.getBuffer().toString('hex'), '01')
    })

    it('should write a one byte integer minus one', function () {
      const writer = new Writer()

      writer.writeInt(-1, 1)

      assert.equal(writer.getBuffer().toString('hex'), 'ff')
    })

    it('should write a two byte integer', function () {
      const writer = new Writer()

      writer.writeInt(258, 2)

      assert.equal(writer.getBuffer().toString('hex'), '0102')
    })

    it('should write a negative two byte integer', function () {
      const writer = new Writer()

      writer.writeInt(-257, 2)

      assert.equal(writer.getBuffer().toString('hex'), 'feff')
    })

    it('should write a small negative two byte integer', function () {
      const writer = new Writer()

      writer.writeInt(-2, 2)

      assert.equal(writer.getBuffer().toString('hex'), 'fffe')
    })

    it('should write a small 8 byte integer', function () {
      const writer = new Writer()

      writer.writeInt(1, 8)

      assert.equal(writer.getBuffer().toString('hex'), '0000000000000001')
    })

    it('should write a small negative 8 byte integer', function () {
      const writer = new Writer()

      writer.writeInt(-2, 8)

      assert.equal(writer.getBuffer().toString('hex'), 'fffffffffffffffe')
    })

    it('when asked to write an integer that does not fit, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(256, 1),
        'Int 256 does not fit in 1 bytes'
      )
    })

    it('when asked to write a negative integer that does not fit, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(-257, 1),
        'Int -257 does not fit in 1 bytes'
      )
    })

    it('when asked to write an integer above safe JavaScript range, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(MAX_SAFE_INTEGER + 1, 1),
        'Int is larger than safe JavaScript range'
      )
    })

    it('when asked to write an integer above safe JavaScript range, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(MIN_SAFE_INTEGER - 1, 1),
        'Int is smaller than safe JavaScript range'
      )
    })

    it('when asked to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt(false as any, 1),
        'Int must be an integer'
      )
    })
  })

  describe('writeVarUInt', function () {
    it('should write a zero', function () {
      const writer = new Writer()

      writer.writeVarUInt(0)

      assert.equal(writer.getBuffer().toString('hex'), '0100')
    })

    it('should write a one-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(16)

      assert.equal(writer.getBuffer().toString('hex'), '0110')
    })

    it('should write a two-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(259)

      assert.equal(writer.getBuffer().toString('hex'), '020103')
    })

    it('should write a four-byte integer', function () {
      const writer = new Writer()

      writer.writeVarUInt(0x01020305)

      assert.equal(writer.getBuffer().toString('hex'), '0401020305')
    })

    it('should write the largest possible number', function () {
      const writer = new Writer()

      writer.writeVarUInt(MAX_SAFE_INTEGER)

      assert.equal(writer.getBuffer().toString('hex'), '071fffffffffffff')
    })

    it('should write larger numbers as BigNumbers', function () {
      const writer = new Writer()

      writer.writeVarUInt(new BigNumber('0100000000000000', 16))

      assert.equal(writer.getBuffer().toString('hex'), '080100000000000000')
    })

    it('when trying to write an unsafe integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarUInt(MAX_SAFE_INTEGER + 1),
        'UInt is larger than safe JavaScript range'
      )
    })

    it('when trying to write an eight-byte integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarUInt(0x0100000000000000),
        'UInt is larger than safe JavaScript range'
      )
    })

    it('when trying to write a negative integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarUInt(-1),
        'UInt must be positive'
      )
    })

    it('when trying to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarUInt(false as any),
        'UInt must be an integer'
      )
    })

    it('should accept a buffer to write', function () {
      const writer = new Writer()

      writer.writeVarUInt(new Buffer('010203040506070810', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '09010203040506070810')
    })
  })

  describe('writeVarInt', function () {
    it('should write a zero', function () {
      const writer = new Writer()

      writer.writeVarInt(0)

      assert.equal(writer.getBuffer().toString('hex'), '0100')
    })

    it('should write a one-byte integer zero', function () {
      const writer = new Writer()

      writer.writeVarInt(0)

      assert.equal(writer.getBuffer().toString('hex'), '0100')
    })

    it('should write a one-byte integer one', function () {
      const writer = new Writer()

      writer.writeVarInt(1)

      assert.equal(writer.getBuffer().toString('hex'), '0101')
    })

    it('should write a one-byte integer minus one', function () {
      const writer = new Writer()

      writer.writeVarInt(-1)

      assert.equal(writer.getBuffer().toString('hex'), '01ff')
    })

    it('should write a two-byte integer', function () {
      const writer = new Writer()

      writer.writeVarInt(259)

      assert.equal(writer.getBuffer().toString('hex'), '020103')
    })

    it('should write a two-byte negative integer', function () {
      const writer = new Writer()

      writer.writeVarInt(-256)

      assert.equal(writer.getBuffer().toString('hex'), '02ff00')
    })

    it('should write a four-byte integer', function () {
      const writer = new Writer()

      writer.writeVarInt(0x01020305)

      assert.equal(writer.getBuffer().toString('hex'), '0401020305')
    })

    it('should write the largest possible number', function () {
      const writer = new Writer()

      writer.writeVarInt(MAX_SAFE_INTEGER)

      assert.equal(writer.getBuffer().toString('hex'), '071fffffffffffff')
    })

    it('when trying to write an unsafe integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarInt(MAX_SAFE_INTEGER + 1),
        'Int is larger than safe JavaScript range'
      )
    })

    it('when trying to write an unsafe negative integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarInt(MIN_SAFE_INTEGER - 1),
        'Int is smaller than safe JavaScript range'
      )
    })

    it('should write an eight byte BigNumber', function () {
      const writer = new Writer()

      writer.writeVarInt(new BigNumber('0100000000000000', 16))

      assert.equal(writer.getBuffer().toString('hex'), '080100000000000000')
    })

    it('should write a large (absolute value) negative integer', function () {
      const writer = new Writer()

      writer.writeVarInt(new BigNumber('-010000000000000000000000000001', 16))

      assert.equal(writer.getBuffer().toString('hex'), '0ffeffffffffffffffffffffffffffff')
    })

    it('when trying to write a non-integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarInt(false as any),
        'Int must be an integer'
      )
    })

    it('should accept a buffer to write', function () {
      const writer = new Writer()

      writer.writeVarInt(new Buffer('010203040506070810', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '09010203040506070810')
    })
  })

  describe('writeOctetString', function () {
    it('should write an empty octet string', function () {
      const writer = new Writer()

      writer.writeOctetString(new Buffer(0), 0)

      assert.equal(writer.getBuffer().toString('hex'), '')
    })

    it('should write an octet string of length 1', function () {
      const writer = new Writer()

      writer.writeOctetString(new Buffer('02', 'hex'), 1)

      assert.equal(writer.getBuffer().toString('hex'), '02')
    })

    it('should write an octet string of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.writeOctetString(buffer, 256)
      const result = writer.getBuffer()

      assert.equal(result.length, 256)
      assert.equal(result.toString('hex'), buffer.toString('hex'))
    })

    it('when writing an octet string of the wrong length, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeOctetString(new Buffer('02', 'hex'), 2),
        'Incorrect length for octet string (actual: 1, expected: 2)'
      )
    })
  })

  describe('writeVarOctetString', function () {
    it('should write an empty buffer', function () {
      const writer = new Writer()

      writer.writeVarOctetString(new Buffer(0))

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a buffer of length 1', function () {
      const writer = new Writer()

      writer.writeVarOctetString(new Buffer('b0', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '01b0')
    })

    it('should write a buffer of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.writeVarOctetString(buffer)
      const result = writer.getBuffer()

      assert.equal(result.length, 259)
      assert.equal(result.toString('hex'), '820100' + buffer.toString('hex'))
    })

    it('when writing a non-buffer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeVarOctetString(false as any),
        'Expects a buffer'
      )
    })
  })

  describe('prependLengthPrefix', function () {
    it('should work for an empty buffer', function () {
      const writer = new Writer()

      writer.prependLengthPrefix()

      assert.equal(writer.getBuffer().toString('hex'), '00')
    })

    it('should write a length prefix for a buffer of length 1', function () {
      const writer = new Writer()

      writer.write(new Buffer('b0', 'hex'))
      writer.prependLengthPrefix()

      assert.equal(writer.getBuffer().toString('hex'), '01b0')
    })

    it('should write a buffer of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.write(buffer)
      writer.prependLengthPrefix()
      const result = writer.getBuffer()

      assert.equal(result.length, 259)
      assert.equal(result.toString('hex'), '820100' + buffer.toString('hex'))
    })
  })

  describe('write', function () {
    it('should write an empty octet string', function () {
      const writer = new Writer()

      writer.write(new Buffer(0))

      assert.equal(writer.getBuffer().toString('hex'), '')
    })

    it('should write an octet string of length 1', function () {
      const writer = new Writer()

      writer.write(new Buffer('02', 'hex'))

      assert.equal(writer.getBuffer().toString('hex'), '02')
    })

    it('should write an octet string of length 256', function () {
      const writer = new Writer()

      const buffer = new Buffer(256)
      buffer.fill(0xb0)
      writer.write(buffer)
      const result = writer.getBuffer()

      assert.equal(result.length, 256)
      assert.equal(result.toString('hex'), buffer.toString('hex'))
    })
  })

  describe('getBuffer', function () {
    it('should return the writer output', function () {
      const writer = new Writer()

      writer.writeVarUInt(256)
      const output = writer.getBuffer()

      assert.isTrue(Buffer.isBuffer(output))
      assert.equal(output.toString('hex'), '020100')
    })

    it('should return a new Buffer each time', function () {
      const writer = new Writer()

      writer.writeVarUInt(256)
      const output1 = writer.getBuffer()
      const output2 = writer.getBuffer()

      assert.isTrue(Buffer.isBuffer(output1))
      assert.isTrue(Buffer.isBuffer(output2))
      assert.equal(output1.toString('hex'), '020100')
      assert.equal(output2.toString('hex'), '020100')
      assert.notEqual(output1, output2)
    })
  })

  describe('writeUInt8', function () {
    it('should write an 8-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt8(0xff)

      assert.equal(writer.getBuffer().toString('hex'), 'ff')
    })
  })

  describe('writeUInt16', function () {
    it('should write an 16-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt16(0xff02)

      assert.equal(writer.getBuffer().toString('hex'), 'ff02')
    })
  })

  describe('writeUInt32', function () {
    it('should write an 32-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt32(0xff020304)

      assert.equal(writer.getBuffer().toString('hex'), 'ff020304')
    })

    it('should fail to write a negative BigNumber', function () {
      const writer = new Writer()

      assert.throws(function () {
        writer.writeUInt32(new BigNumber(-1))
      } , 'UInt must be positive')
    })
  })

  describe('writeUInt64', function () {
    it('should write an 64-bit integer formatted as an array', function () {
      const writer = new Writer()

      writer.writeUInt64([0xff020304, 0x05060708])

      assert.equal(writer.getBuffer().toString('hex'), 'ff02030405060708')
    })

    it('should write an integer that is not formatted as an array', function () {
      const writer = new Writer()

      writer.writeUInt64(0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should write a string', function () {
      const writer = new Writer()

      writer.writeUInt64(String(0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should write a BigNumber', function () {
      const writer = new Writer()

      writer.writeUInt64(new BigNumber(0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('when writing an unsafe Javascript integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeUInt64(MAX_SAFE_INTEGER + 1),
        'UInt is larger than safe JavaScript range (try using BigNumbers instead)'
      )
    })

    it('should write a 64-bit integer', function () {
      const writer = new Writer()

      writer.writeUInt64(0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should fail to write a negative BigNumber', function () {
      const writer = new Writer()

      assert.throws(function () {
        writer.writeUInt64(new BigNumber(-1))
      } , 'UInt must be positive')
    })

    it('should fail to write a BigNumber that is too large', function () {
      const writer = new Writer()

      assert.throws(function () {
        writer.writeUInt64(new BigNumber(0x10102030405060708))
      } , 'UInt 18519367933499933000 does not fit in 8 bytes')
    })
  })

  describe('writeInt8', function () {
    it('should write an 8-bit integer', function () {
      const writer = new Writer()

      writer.writeInt8(0x7f)

      assert.equal(writer.getBuffer().toString('hex'), '7f')
    })

    it('should write a negative 8-bit integer', function () {
      const writer = new Writer()

      writer.writeInt8(-0x80)

      assert.equal(writer.getBuffer().toString('hex'), '80')
    })
  })

  describe('writeInt16', function () {
    it('should write an 16-bit integer', function () {
      const writer = new Writer()

      writer.writeInt16(0x7f02)

      assert.equal(writer.getBuffer().toString('hex'), '7f02')
    })

    it('should write an 16-bit integer', function () {
      const writer = new Writer()

      writer.writeInt16(-0x7f50)

      assert.equal(writer.getBuffer().toString('hex'), '80b0')
    })
  })

  describe('writeInt32', function () {
    it('should write an 32-bit integer', function () {
      const writer = new Writer()

      writer.writeInt32(0x7f020304)

      assert.equal(writer.getBuffer().toString('hex'), '7f020304')
    })

    it('should write a negative 32-bit integer', function () {
      const writer = new Writer()

      writer.writeInt32(-0x7f020304)

      assert.equal(writer.getBuffer().toString('hex'), '80fdfcfc')
    })

    it('should write a string', function () {
      const writer = new Writer()

      writer.writeUInt32(String(0x03040506))

      assert.equal(writer.getBuffer().toString('hex'), '03040506')
    })

    it('should write a BigNumber', function () {
      const writer = new Writer()

      writer.writeUInt32(new BigNumber(0x03040506))

      assert.equal(writer.getBuffer().toString('hex'), '03040506')
    })
  })

  describe('writeInt64', function () {
    it('should write a positive integer', function () {
      const writer = new Writer()

      writer.writeInt64(0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should write a negative integer', function () {
      const writer = new Writer()

      writer.writeInt64(-0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), 'ffff00fdfcfbfafa')
    })

    it('should write a positive integer as a string', function () {
      const writer = new Writer()

      writer.writeInt64(String(0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should write a positive integer as a string', function () {
      const writer = new Writer()

      writer.writeInt64(String(-0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), 'ffff00fdfcfbfafa')
    })

    it('should write a positive integer as a BigNumber', function () {
      const writer = new Writer()

      writer.writeInt64(new BigNumber(0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should write a negative integer as a BigNumber', function () {
      const writer = new Writer()

      writer.writeInt64(new BigNumber(-0xff0203040506))

      assert.equal(writer.getBuffer().toString('hex'), 'ffff00fdfcfbfafa')
    })

    it('when writing an unsafe Javascript integer, should throw', function () {
      const writer = new Writer()

      assert.throws(
        () => writer.writeInt64(MAX_SAFE_INTEGER + 1),
        'Int is larger than safe JavaScript range (try using BigNumbers instead)'
      )
    })

    it('should write a 64-bit integer', function () {
      const writer = new Writer()

      writer.writeInt64(0xff0203040506)

      assert.equal(writer.getBuffer().toString('hex'), '0000ff0203040506')
    })

    it('should fail to write a BigNumber that is too small', function () {
      const writer = new Writer()

      assert.throws(function () {
        writer.writeInt64(new BigNumber(-0x101020304050607080))
      } , 'Int -296309886935998900000 does not fit in 8 bytes')
    })

    it('should fail to write a BigNumber that is too large', function () {
      const writer = new Writer()

      assert.throws(function () {
        writer.writeInt64(new BigNumber(0x10102030405060708))
      } , 'Int 18519367933499933000 does not fit in 8 bytes')
    })
  })
})
