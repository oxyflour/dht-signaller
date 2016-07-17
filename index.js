var SimplePeer = require('simple-peer'),
	debug = require('debug')('simple-peer-dht-signaller'),
	crypto = require('crypto'),
	events = require('events'),
	util = require('util')

function debounced(func, delay) {
	var timeout = 0
	return function() {
		var self = this,
			args = arguments
		if (timeout) {
			clearTimeout(timeout)
		}
		timeout = setTimeout(_ => {
			func.apply(self, args)
		}, delay)
	}
}

function Signaller(seed, wsUrl, peerOpts, ioOpts) {
	this.offers = { }
	this.answers = { }

	this.saveOfferDebounced = debounced(_ => this.saveToDHT(), 500)
	this.checkAnswerDebounced = debounced(_ => this.checkFromDHT(), 3000)

	if (!seed) {
		throw 'seed (string or buffer) is required!'
	}
	else {
		seed = crypto.createHash('sha256').update(seed).digest()
	}

	// signal -> saveOffer -> checkFromDHT -> emitAnswers -> checkFromDHT...
	if (peerOpts && peerOpts.initiator) {
		this.isInitiator = true
		debug('new signal initiator started')
	}
	// checkFromDHT -> emitAnswers -> checkFromDHT ...
	// signal -> saveOffer
	else {
		this.isInitiator = false
		debug('new signal acceptor started')
	}

	this.sock = io(wsUrl, ioOpts)
	this.sock.$once = (msg) => new Promise(resolve => this.sock.once(msg, resolve))
	this.sock.$emit = (evt, data) => new Promise(resolve => this.sock.emit(evt, data, resolve))

	this.sock.$once('connect')
		.then(_ => this.sock.$emit('seed', seed.toString('hex')))
		.then(pubKey => this.pubKey = new Buffer(pubKey, 'hex'))
		.then(_ => {
			return this.isInitiator ?
				this.sock.$emit('put', { val:{ }, salt:'answer' }) :
				this.checkAnswerDebounced()
		})
		.then(_ => {
			this.peer = new SimplePeer(peerOpts)
			this.peer.on('signal', data => this.saveOffer(data))
			this.peer.on('connect', _ => {
				this.isConnected = true
				this.sock.disconnect()
				this.emit('connect', this.peer)
			})
		})

	this.sock.on('error', err => {
		debug('error: %s', err)
		this.emit('error', err)
	})

	events.EventEmitter.call(this)

	this.on('error', err => {
		console.error(err)
	})
}

util.inherits(Signaller, events.EventEmitter)

Signaller.prototype.saveOffer = function(offer) {
	var hash = crypto.createHash('sha1')
		.update(JSON.stringify(offer)).digest().toString('hex')
	this.offers[hash] = offer
	this.saveOfferDebounced()
}

Signaller.prototype.emitAnswers = function(answers) {
	Object.keys(answers).filter(hash => !this.answers[hash]).forEach(hash => {
		this.answers[hash] = answers[hash]
		this.peer.signal(answers[hash])
		debug('[%s] answer %s emited', this.isInitiator ? 'i' : 'a', hash)
	})
	
	if (!this.isConnected)
		this.checkAnswerDebounced()
}

Signaller.prototype.saveToDHT = function() {
	var salt = this.isInitiator ? 'offer' : 'answer',
		val = this.offers
	this.sock.emit('put', { val, salt }, (ret) => {
		debug('[%s] put return %s, err %s', this.isInitiator ? 'i' : 'a', ret.hash, ret.err)
		if (ret.err)
			this.emit('error', ret.err)
		if (this.isInitiator) {
			this.checkAnswerDebounced()
			if (!this.isReady && (this.isReady = true))
				this.emit('ready')
		}
		this.emit('put', ret)
	})
}

Signaller.prototype.checkFromDHT = function() {
	var salt = this.isInitiator ? 'answer' : 'offer',
		info = Buffer.concat([new Buffer(salt), this.pubKey]),
		hash = crypto.createHash('sha1').update(info).digest().toString('hex')
	this.sock.emit('get', hash, (ret) => {
		debug('[%s] got hash %s, err %s', this.isInitiator ? 'i' : 'a', hash, ret.err)
		if (ret.err)
			this.emit('error', ret.err)
		else
			this.emitAnswers(ret.val || { })
		this.emit('get', ret)
	})
}

module.exports = Signaller