import { create as createLogger } from '../common/log'
const log = createLogger('rate-limit-middleware')
import RateLimitExceededError from '../errors/rate-limit-exceeded-error'
import { Middleware, MiddlewareCallback, MiddlewareServices, Pipelines } from '../types/middleware'
import { AccountInfo } from '../types/accounts'
import TokenBucket from '../lib/token-bucket'

const DEFAULT_REFILL_PERIOD = 60 * 1000 // 1 minute
const DEFAULT_REFILL_COUNT = 10000

export default class RateLimitMiddleware implements Middleware {
  private getInfo: (accountId: string) => AccountInfo

  constructor (opts: {}, { getInfo }: MiddlewareServices) {
    this.getInfo = getInfo
  }

  async applyToPipelines (pipelines: Pipelines, accountId: string) {
    const accountInfo = this.getInfo(accountId)
    if (!accountInfo) {
      throw new Error('could not load info for account. accountId=' + accountId)
    }
    const {
      refillPeriod = DEFAULT_REFILL_PERIOD,
      refillCount = DEFAULT_REFILL_COUNT,
      capacity = refillCount
    } = accountInfo.rateLimit || {}

    log.debug('created token bucket for account. accountId=%s refillPeriod=%s refillCount=%s capacity=%s', accountId, refillPeriod, refillCount, capacity)

    // TODO: When we add the ability to update middleware, our state will get
    //   reset every update, which may not be desired.
    const bucket = new TokenBucket({ refillPeriod, refillCount })

    pipelines.incomingData.insertLast({
      name: 'rateLimit',
      method: async (data: Buffer, next: MiddlewareCallback<Buffer, Buffer>) => {
        if (!bucket.take()) {
          throw new RateLimitExceededError('too many requests, throttling.')
        }

        return next(data)
      }
    })

    pipelines.incomingMoney.insertLast({
      name: 'rateLimit',
      method: async (amount: string, next: MiddlewareCallback<string, void>) => {
        if (!bucket.take()) {
          throw new RateLimitExceededError('too many requests, throttling.')
        }

        return next(amount)
      }
    })
  }
}
