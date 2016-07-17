const DHT = require('bittorrent-dht'),
	KeyPair = require('bittorrent-dht-store-keypair'),
	debug = require('debug')('simple-peer-dht-signaller'),
	ed = require('ed25519-supercop'),
	events = require('events'),
	util = require('util')

function Server(opts) {
	this.dht = new DHT(Object.assign({ verify: KeyPair.verify }, opts))
	this.dht.on('ready', _ => this.emit('ready'))

	events.EventEmitter.call(this)
}

util.inherits(Server, events.EventEmitter)

Server.prototype.accept = function(sock) {
	var kp

	sock.once('seed', (seed, callback) => {
		var seed = new Buffer(seed, 'hex'),
			keys = ed.createKeyPair(seed)
		kp = new KeyPair(keys)
		callback(kp.publicKey.toString('hex'))
	})

	sock.on('get', (hash, callback) => {
		this.$get(hash)
			.then(res => res && res.v && res.v.toString())
			.then(val => {
				if (val && val[0] === ':') {
					var hashes = val.split(':').slice(1).filter(h => !!h)
					return this.$getMulti(hashes).then(rets => rets.map(r => r.v).join(''))
				}
				return val
			})
			.then(val => callback({ val: JSON.parse(val) }))
			.catch(err => callback({ err: err && err.message || err }))
	})

	sock.on('put', (opts, callback) => {
		var val = JSON.stringify(opts.val),
			salt = new Buffer(opts.salt),
			// FIXME: have to set seq = 0 or we cannot put data
			seq = 0

		debug('%s bytes to put', val.length)
		var req = val.length > 600 ?
			this.$putMulti(val, 600).then(hashes => ':' + hashes.join(':')) :
			Promise.resolve(val)

		req.then(val => kp.store(val, { salt, seq }))
			.then(opts => this.$put(opts))
			.then(hash => callback({ hash }))
			.catch(err => callback({ err: err && err.message || err }))
	})

	sock.on('error', err => {
		console.error(err)
	})
}

Server.prototype.$put = function(opts) {
	return new Promise((resolve, reject) => {
		debug('putting ``%s`` %s', opts.v, opts.k ? 'mutable' : 'immutable')
		this.dht.put(opts, (err, hash, count) => {
			debug('put %s ``%s`` to %d nodes', hash.toString('hex'), opts.v, count)
			err ? reject(err) : resolve(hash.toString('hex'))
		})
	})
}

Server.prototype.$get = function(hash) {
	return new Promise((resolve, reject) => {
		debug('getting %s', hash)
		this.dht.get(hash, (err, res) => {
			debug('got %s %s', hash, res && res.v)
			err ? reject(err) : resolve(res)
		})
	})
}

Server.prototype.$putMulti = function(val, size) {
	var splitedVal = Array(Math.floor(val.length / size) + 1).fill(0)
			.map((_, i) => val.substr(i * size, size))
	return Promise.all(splitedVal.map(v => this.$put({ v })))
}

Server.prototype.$getMulti = function(hashes) {
	return Promise.all(hashes.map(hash => this.$get(hash)))
}

module.exports = Server