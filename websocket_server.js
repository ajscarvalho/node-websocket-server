
var sys = require("util"),
	net = require("net"),
	tls = require("tls"),
	crypto = require("crypto"); // websocket.js

require("./helper"); // websocket.js
require("./websocket");

/** @constructor */
WebSocketServer = function(callback, options){ this.init(callback, options); };

WebSocketServer.FLASH_POLICY = '<cross-domain-policy><allow-access-from domain="*" to-ports="*" /></cross-domain-policy>';

WebSocketServer.createServer = function(callback, options)
{
	var server = new WebSocketServer(callback, options);
	server.socket = net.createServer(server.newConnection.bind(server));
	return server;
}

WebSocketServer.createSecureServer = function(callback, options)
{
	var server = new WebSocketServer(callback, options);
	server.socket = tls.createServer(this.options, server.newConnection.bind(server));
	return server;
}


WebSocketServer.prototype.newConnectionCallback = null;
WebSocketServer.prototype.options = null;
WebSocketServer.prototype.socket = null;

WebSocketServer.prototype.init = function(callback, options)
{
	this.setOptions(options);
	this.newConnectionCallback = callback;
}

WebSocketServer.prototype.newConnection = function(socket, secureStream)
{
	socket.setTimeout(0);
	socket.setNoDelay(true);
//	socket.setKeepAlive(true, 0);
	var websocket = new WebSocket(this, socket);
	if (this.newConnectionCallback) this.newConnectionCallback(websocket);
	else console.log('WebSocket.create* you should supply a callback');
}

WebSocketServer.prototype.setOptions = function(options)
{
	if (!options) options = {};
	if (!options.flashPolicy) options.flashPolicy = WebSocketServer.FLASH_POLICY;
	this.options = options;
}

WebSocketServer.prototype.listen = function(port)
{
	this.socket.listen(port);
}
