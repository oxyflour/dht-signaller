#!/usr/bin/env node

const HTTP = require('http'),
	SocketIO = require('socket.io'),

	SignallerServer = require('./server'),

	server = HTTP.createServer(),
	io = SocketIO(server),
	sig = new SignallerServer(),

	port = parseInt(process.argv[2]) || 6881

sig.on('ready', _ => {
	io.on('connection', sock => {
		sig.accept(sock)
	})

	server.listen(port, _ => {
		console.log('start listenning at port ' + port)
	})
})
