'use strict'

const UnprocessableEntityError =
require('five-bells-shared/errors/unprocessable-entity-error')

class UnacceptableBackendAmountError extends UnprocessableEntityError {
  * handler (ctx, log) {
    log.warn('Unacceptable Amount: ' + this.message)
    ctx.status = 422
    ctx.body = {
      id: this.name,
      message: this.message
    }
  }
}

module.exports = UnacceptableBackendAmountError
