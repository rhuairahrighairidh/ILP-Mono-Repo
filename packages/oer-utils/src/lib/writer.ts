import { isInteger } from './util'
import BigNumber from 'bignumber.js'

class Writer {
  // Largest value that can be written as a variable-length unsigned integer
  static MAX_SAFE_INTEGER: number = 0x1fffffffffffff
  static MIN_SAFE_INTEGER: number = -0x1fffffffffffff

  static UINT_RANGES = {
    1: 0xff,
    2: 0xffff,
    3: 0xffffff,
    4: 0xffffffff,
    5: 0xffffffffff,
    6: 0xffffffffffff,
    8: new BigNumber(2).exponentiatedBy(64)
  }

  static INT_RANGES = {
    1: [-0x80, 0x7f],
    2: [-0x8000, 0x7fff],
    3: [-0x800000, 0x7fffff],
    4: [-0x80000000, 0x7fffffff],
    5: [-0x8000000000, 0x7fffffffff],
    6: [-0x800000000000, 0x7fffffffffff],
    8: [new BigNumber('-80000000000000', 16), new BigNumber('7fffffffffffff', 16)]
  }

  components: Buffer[]

  constructor () {
    this.components = []
  }

  /**
   * Write a fixed-length unsigned integer to the stream.
   *
   * @param {number | string | BigNumber} value Value to write. Must be in range for the given length.
   * @param {number} length Number of bytes to encode this value as.
   */
  writeUInt (_value: BigNumber.Value | number[], length: number) {
    if (Array.isArray(_value)) {
      this.writeUInt32(_value[0])
      this.writeUInt32(_value[1])
      return
    }
    if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('UInt is larger than safe JavaScript range (try using BigNumbers instead)')
    }

    const value = new BigNumber(_value)
    if (value.isLessThan(0)) {
      throw new Error('UInt must be positive')
    } else if (length <= 0) {
      throw new Error('UInt length must be greater than zero')
    } else if (value.isGreaterThan(Writer.UINT_RANGES[length])) {
      throw new Error(`UInt ${value} does not fit in ${length} bytes`)
    }

    if (value.isLessThan(Writer.UINT_RANGES[6]) && length <= 6) {
      const buffer = new Buffer(length)
      buffer.writeUIntBE(value.toNumber(), 0, length)
      this.write(buffer)
    } else {
      let hex = value.toString(16)
      hex = '0'.repeat(length * 2 - hex.length) + hex
      this.write(Buffer.from(hex, 'hex'))
    }
  }

  /**
   * Write a fixed-length signed integer to the stream.
   *
   * @param {number | string | BigNumber} value Value to write. Must be in range for the given length.
   * @param {number} length Number of bytes to encode this value as.
   */
  writeInt (_value: BigNumber.Value, length: number) {
    if (!isInteger(_value)) {
      throw new Error('Int must be an integer')
    } else if (length <= 0) {
      throw new Error('Int length must be greater than zero')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range')
    } else if (typeof _value === 'number' && _value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range')
    }
    const value = new BigNumber(_value)
    if (value.isLessThan(Writer.INT_RANGES[length][0])) {
      throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
    } else if (value.isGreaterThan(Writer.INT_RANGES[length][1])) {
      throw new Error('Int ' + value + ' does not fit in ' + length + ' bytes')
    }

    const valueToWrite = value.isLessThan(0) ? new BigNumber('ff'.repeat(length), 16).plus(1).plus(value) : value
    let hex = valueToWrite.toString(16)
    hex = '0'.repeat(length * 2 - hex.length) + hex

    this.write(Buffer.from(hex, 'hex'))
  }

  /**
   * Write a variable length unsigned integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {number | string | BigNumber | Buffer} value Integer to represent.
   */
  writeVarUInt (_value: BigNumber.Value | Buffer) {
    if (Buffer.isBuffer(_value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(_value)
      return
    } else if (!isInteger(_value)) {
      throw new Error('UInt must be an integer')
    }
    if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('UInt is larger than safe JavaScript range')
    }
    const value = new BigNumber(_value)
    if (value.isLessThan(0)) {
      throw new Error('UInt must be positive')
    }

    const lengthOfValue = Math.ceil(value.toString(2).length / 8)
    let hex = value.toString(16)
    hex = '0'.repeat(lengthOfValue * 2 - hex.length) + hex

    this.writeVarOctetString(Buffer.from(hex, 'hex'))
  }

  /**
   * Write a variable length signed integer to the stream.
   *
   * We need to first turn the integer into a buffer in big endian order, then
   * we write the buffer as an octet string.
   *
   * @param {number | string | BigNumber | Buffer} value Integer to represent.
   */
  writeVarInt (_value: BigNumber.Value | Buffer) {
    if (Buffer.isBuffer(_value)) {
      // If the integer was already passed as a buffer, we can just treat it as
      // an octet string.
      this.writeVarOctetString(_value)
      return
    } else if (!isInteger(_value)) {
      throw new Error('Int must be an integer')
    } else if (typeof _value === 'number' && _value > Writer.MAX_SAFE_INTEGER) {
      throw new Error('Int is larger than safe JavaScript range')
    } else if (typeof _value === 'number' && _value < Writer.MIN_SAFE_INTEGER) {
      throw new Error('Int is smaller than safe JavaScript range')
    }
    const value = new BigNumber(_value)

    const lengthDeterminingValue = value.isLessThan(0) ? new BigNumber(1).minus(value) : value
    const lengthOfValue = Math.ceil((lengthDeterminingValue.toString(2).length + 1) / 8)
    const valueToWrite = value.isLessThan(0) ? new BigNumber('ff'.repeat(lengthOfValue), 16).plus(1).plus(value) : value
    let hex = valueToWrite.toString(16)
    hex = '0'.repeat(lengthOfValue * 2 - hex.length) + hex

    this.writeVarOctetString(Buffer.from(hex, 'hex'))
  }

  /**
   * Write a fixed-length octet string.
   *
   * Mostly just a raw write, but this method enforces the length of the
   * provided buffer is correct.
   *
   * @param {Buffer} buffer Data to write.
   * @param {number} length Length of data according to the format.
   */
  writeOctetString (buffer: Buffer, length: number) {
    if (buffer.length !== length) {
      throw new Error('Incorrect length for octet string (actual: ' +
        buffer.length + ', expected: ' + length + ')')
    }
    this.write(buffer)
  }

  /**
   * Write a variable-length octet string.
   *
   * A variable-length octet string is a length-prefixed set of arbitrary bytes.
   *
   * @param {Buffer} buffer Contents of the octet string.
   */
  writeVarOctetString (buffer: Buffer) {
    if (!Buffer.isBuffer(buffer)) {
      throw new TypeError('Expects a buffer')
    }

    const MSB = 0x80

    if (buffer.length <= 127) {
      // For buffers shorter than 128 bytes, we simply prefix the length as a
      // single byte.
      this.writeUInt8(buffer.length)
    } else {
      // For buffers longer than 128 bytes, we first write a single byte
      // containing the length of the length in bytes, with the most significant
      // bit set.
      const lengthOfLength = Math.ceil(buffer.length.toString(2).length / 8)
      this.writeUInt8(MSB | lengthOfLength)

      // Then we write the length of the buffer in that many bytes.
      this.writeUInt(buffer.length, lengthOfLength)
    }

    this.write(buffer)
  }

  /**
   * Write a series of raw bytes.
   *
   * Adds the given bytes to the output buffer.
   *
   * @param {Buffer} buffer Bytes to write.
   */
  write (buffer: Buffer) {
    this.components.push(buffer)
  }

  /**
   * Return the resulting buffer.
   *
   * Returns the buffer containing the serialized data that was written using
   * this writer.
   *
   * @return {Buffer} Result data.
   */
  getBuffer () {
    // ST: The following debug statement is very useful, so I finally decided to
    // commit it...
    // console.log(this.components.map((x) => x.toString('hex')).join(' '))

    return Buffer.concat(this.components)
  }
}

interface Writer {
  writeUInt8 (value: BigNumber.Value): undefined
  writeUInt16 (value: BigNumber.Value): undefined
  writeUInt32 (value: BigNumber.Value): undefined
  writeUInt64 (value: BigNumber.Value | number[]): undefined
  writeInt8 (value: BigNumber.Value): undefined
  writeInt16 (value: BigNumber.Value): undefined
  writeInt32 (value: BigNumber.Value): undefined
  writeInt64 (value: BigNumber.Value): undefined
}

// Create write(U)Int{8,16,32,64} shortcuts
[1, 2, 4, 8].forEach((bytes) => {
  Writer.prototype['writeUInt' + bytes * 8] = function (value: number) {
    this.writeUInt(value, bytes)
  }

  Writer.prototype['writeInt' + bytes * 8] = function (value: number) {
    this.writeInt(value, bytes)
  }
})

export default Writer
