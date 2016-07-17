var Signaller = require('../'),
	url = require('url')

var loc = url.parse(location.href, true),
	initiator = !loc.query.salt,
	salt = loc.query.salt ||
		(loc.query.salt = (1e6 + Math.floor(1e6 * Math.random())).toString().substr(-6))

var seed = 'some random strings!!!!',
	host = initiator ? 'vlr.ofr.me:6881' : 'vlr.ofr.me:6882',
	scriptUrl = 'http://' + host + '/socket.io/socket.io.js',
	wsUrl = 'ws://' + host

var script = document.createElement('script')
script.src = scriptUrl
script.onload = function() {
	var sig = new Signaller(seed + salt, wsUrl,
		{ initiator }, { transports:['websocket'] })

	sig.on('ready', _ => {
		delete loc.search
		var u = url.format(loc),
			a = '<a href="' + u + '">' + u + '</a> '
		document.write('open ' + a + 'in another window to connect<br />')
	})

	sig.on('connect', _ => {
		document.write('<b>connected!</b>')
	})
}
document.body.appendChild(script)
