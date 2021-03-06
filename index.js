const eos = require('dazaar-eos-stream')

const MAX_SUBSCRIBER_CACHE = 500

module.exports = class DazaarEOSPayment {
  constructor (dazaar, payment, opts = {}) {
    this.dazaar = dazaar.key
    this.payment = payment
    this.eos = eos({ account: payment.payTo, ...opts })
    this.subscribers = new Map()
    this.destroyed = false
    this.supports = this.constructor.supports
  }

  validate (buyer, cb) {
    if (this.destroyed) return process.nextTick(cb, new Error('Seller is shutting down'))
    const tail = this._get(buyer)

    const timeout = setTimeout(ontimeout, 20000)
    let timedout = false
    if (tail.synced || tail.active()) return process.nextTick(onsynced)

    tail.once('synced', onsynced)
    tail.once('close', onsynced)
    tail.on('update', onupdate)

    function ontimeout () {
      timedout = true
      onsynced()
    }

    function onupdate () {
      if (tail.active()) onsynced()
    }

    function onsynced () {
      tail.removeListener('synced', onsynced)
      tail.removeListener('close', onsynced)
      tail.removeListener('update', onupdate)
      clearTimeout(timeout)

      const time = tail.remainingTime()
      if (time <= 0) return cb(new Error('No time left on subscription' + (timedout ? ' after timeout' : '')))

      cb(null, {
        type: 'time',
        remaining: time
      })
    }
  }

  buy (seller, amount, auth, cb) {
    const e = eos(auth)
    e.pay(this.payment.payTo, amount, this._filter(seller, false), cb)
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true

    for (const tail of this.subscribers.values()) {
      tail.destroy()
    }
  }

  _filter (key, seller = true) {
    return seller ? metadata(this.dazaar, key) : metadata(key, this.dazaar)
  }

  _get (buyer) {
    const h = buyer.toString('hex')
    if (this.subscribers.has(h)) return this.subscribers.get(h)
    if (this.subscribers.size >= MAX_SUBSCRIBER_CACHE) this._gc()

    const self = this
    const tail = this.eos.subscription(this._filter(buyer), this.payment)
    this.subscribers.set(h, tail)

    tail.on('error', () => tail.destroy())
    tail.on('close', onclose)

    return tail

    function onclose () {
      if (self.subscribers.get(h) === tail) self.subscribers.delete(h)
    }
  }

  _gc () {
    // just remove the first one
    for (const [h, tail] of this.subscribers) {
      tail.destroy()
      this.subscribers.delete(h)
      return
    }
  }

  static supports (payment) {
    return payment.currency === 'EOS'
  }
}

function metadata (seller, buyer) {
  return 'dazaar: ' + seller.toString('hex') + ' ' + buyer.toString('hex')
}
