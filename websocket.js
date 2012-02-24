
/** @constructor */
WebSocket = function(serverInstance, socket){ this.init(serverInstance, socket); };

WebSocket.REQUIRED_HEADERS = {
	'get': /^GET (\/[^\s]*)/,
	'upgrade': /^WebSocket$/,
	'connection': /^Upgrade$/,
	'host': /^(.+)$/,
	'origin': /^(.+)$/
};

WebSocket.prototype.serverInstance = null;
WebSocket.prototype.socket = null;
WebSocket.prototype.emitter = null;
WebSocket.prototype.handshaked = false;
WebSocket.prototype.buffer = "";
WebSocket.prototype.version = null;
WebSocket.prototype.socketClosing = false;

WebSocket.prototype.init = function(serverInstance, socket)
{
	this.serverInstance = serverInstance;
	this.socket = socket; // remoteAddress = this.socket.remoteAddress
	this.emitter = new process.EventEmitter();

	this.emitter.websocket = this;
	this.emitter.write = function(data) { this.websocket.write(data); }
	this.emitter.end = function() { this.websocket.end(); }

	socket.addListener("data", this.processDataEvent.bind(this));
	socket.addListener("end", this.processEndEvent.bind(this));
	socket.addListener("close", this.processCloseEvent.bind(this));
	socket.addListener("error", this.processErrorEvent.bind(this));
}

WebSocket.prototype.addListener = function(event, callback)
{
	this.emitter.addListener(event, callback);
}

/**
 * Writing 
 */
				
WebSocket.prototype.draft10_write = function(data)
{
	var byteLen, packetHeader;

	try
	{ 
		byteLen = Buffer.byteLength(data, 'utf8');

		if (byteLen > 80000000) { // >64K? TODO
			packetHeader = new Buffer(16); // 16?
		} else if (byteLen > 125) {
			packetHeader = new Buffer(4);
		} else {
			packetHeader = new Buffer(2);
		}

		packetHeader[0] = 0x81; // for binary: change here to 0x82

		if (byteLen > 125) {
			packetHeader[1] = 126;
			packetHeader[2] = byteLen >> 8;
			packetHeader[3] = byteLen & 0xFF;
		} else {
			packetHeader[1] = byteLen;
		}

		this.socket.write(packetHeader, 'binary');
		this.socket.write(data, 'utf-8'); // for binary: change here to 'binary'
	} catch(e) {
		// Socket not open for writing,
		// should get "close" event just before.
console.log('closing due to exception writing: ', this.version, e);
		try { this.end(); } catch(e) { console.log('closing due to exception writing, error closing', this.version, e); }
	}
};

WebSocket.prototype.old_write = function(data)
{
	try {
		this.socket.write('\u0000', 'binary');
		this.socket.write(data, 'utf8');//this might be the issue
		this.socket.write('\uffff', 'binary');
	} catch(e) {
console.log('closing due to exception writing: ', this.version, e);
		try { this.end(); } catch(e) { console.log('closing due to exception writing : ', this.version, e); }
	}
};



/**
 * Closing
 */

WebSocket.prototype.end = function()
{
	if (this.socketClosing) return console.log("called end on an already ended socket - nothing to do");
	if (!this.socket.writable) return console.log("called end on an unwriteable socket - nothing to do");
	try {
		this.socketClosing = true;
		if (this.version == 'draft10') return this.sendCloseFrame();
		this.socket.end();
	} catch(e) { console.log('error closing socket : ', this.version, e); }
};


WebSocket.prototype.sendCloseFrame = function()
{
console.log('sending close frame');
	var data = 'Server Application Requested close',
		byteLen = Buffer.byteLength(data, 'utf8'),
		packetHeader;

	if (byteLen > 125) {
		packetHeader = new Buffer(4);
	} else {
		packetHeader = new Buffer(2);
	}

	packetHeader[0] = 0x08; // close frame

	if (byteLen > 125) {
		packetHeader[1] = 126;
		packetHeader[2] = byteLen >> 8;
		packetHeader[3] = byteLen & 0xFF;
	} else {
		packetHeader[1] = byteLen;
	}
	this.socket.write(packetHeader, 'binary');
	this.socket.write(data, 'utf-8'); // for binary: change here to 'binary'
}

/**
 * Reading
 */

WebSocket.prototype.old_handle = function(binaryData)
{
	// draft75, 76
	var data = binaryData.toString("utf8");
	this.buffer += data;

	var chunks = this.buffer.split("\ufffd"), // TODO analyse split result
	count = chunks.length - 1; // last is "" or a partial packet

	for(var i = 0; i < count; i++) {
		var chunk = chunks[i];
		if(chunk[0] == "\u0000") {
//console.log("emitting DATA", data, this.version);
			this.emitter.emit("data", chunk.slice(1));
		} else {
			try { this.buffer = ""; this.end(); } catch(e) { console.log("exception reading (old-handle)", e) }
			return;
		}
	}

	this.buffer = chunks[count]; //get last partial
};

WebSocket.prototype.draft10_handle = function(binaryData)
{
	var frameData, frameLen,
		mask = null,
		len = 0,
		pkt,
		data = binaryData,
		i,
		isFinalFrame,
		isControlFrame;

// can have several packets together - cycle
	do 
	{
		if ((data[0] & 0x0f) == 0x0a) { isControlFrame = true; } // pong -> ignore
		else if ((data[0] & 0x0f) == 0x09) { this.pong(data); isControlFrame = true; } //ping->pong
		else if ((data[0] & 0x0f) == 0x08) return this.closeReceived(data); // close

		isFinalFrame = (data[0] & 0x80) == 0x80; // final frame returns 0x80; 1xxx xxxx

		len = data[1] & 0x7f;
//console.log('len nibble = ', len);

		if (len < 126)
		{
			mask = data.slice(2, 6);
			i = 6; // skip the mask bytes
//console.log('skip mask minor');
		}
		else if (len == 126)
		{
			mask = data.slice(4, 8);
			i = 8; // skip the mask bytes
			var lengthBytes = data.slice(2, 4);
			len = lengthBytes[1] + (lengthBytes[0] << 8);
//console.log('skip mask major, len=', len);
		}

//console.log(len, data.length, i);
		var sliceEnd = i+len;
		if (sliceEnd > data.length)
		{
			console.log('trying to slice a ', len, 'bytes slice from', i, 'to', i+len, 'on a', data.length, 'buffer: ', data);
			sliceEnd = data.length -1;
		} 

		frameData = data.slice(i, sliceEnd);
		data = data.slice(sliceEnd);

//		if (data.length > i+len) {
//			 moreData = true;
//	frameLen = frameData.length; // original bug?
//console.log(frameLen);
		pkt = new Buffer(len);

		for (var j = 0; j < len; j++) {
			pkt[j] = frameData[j] ^ mask[j % 4];
		}

//if (isControlFrame) console.log("controlFrame");
//if (data.length) console.log("moreData", data.length);
		if (isFinalFrame) // continuation frame
		{
			if (!isControlFrame) 
				this.emitter.emit('data', this.buffer + pkt.toString('utf8'));
			this.buffer = "";
		}
		else
		{
//console.log('continuation frame');
			//TODO keep track of binary/text opcode
			if (!isControlFrame) 
				this.buffer = this.buffer  + pkt.toString('utf8');
		}
	//console.log('data', pkt.toString('utf8', 0, pkt.length));
	} while (data.length);
};


/**
 * Other Events
 */
 
WebSocket.prototype.pong = function(data)
{
	data[0] = 0x0A;
	this.socket.write(data, 'binary');
}

WebSocket.prototype.closeReceived = function(data)
{
	try {
console.log('close received', data);
//console.log(getData_draft10(data));
		this.emitter.emit('close');
		this.socket.write(data, 'binary');// send close back
		this.end();
	} catch(e) { console.log("close Received Error", this.version, e); }
}


/**
 * Internal events
 */
 
WebSocket.prototype.processDataEvent = function(data)
{
	if (this.handshaked) {
		this.handle(data);
	} else {
		this.handshake(data.toString("binary")); // because of draft76 handshakes
	}
};

WebSocket.prototype.processEndEvent = function()
{
	try { 
		if (this.socket.writable) this.end(); 
	} catch(e) { console.log('error ending socket : ', this.version, e); }
};

WebSocket.prototype.processCloseEvent = function()
{
console.log('addListener close (socket closed)', this.handshaked);
	if (this.handshaked) { // don't emit close from policy-requests
		this.emitter.emit("close");
	}
};

WebSocket.prototype.processErrorEvent = function(exception)
{
console.log('error');
	if (this.emitter.listeners("error").length > 0) {
		this.emitter.emit("error", exception);
	} else {
		throw exception;
	}
};






/**
 * Handshakes
 */
 
WebSocket.HANDSHAKE_TEMPLATE_75 = [
	'HTTP/1.1 101 Web Socket Protocol Handshake', 
	'Upgrade: WebSocket', 
	'Connection: Upgrade',
	'WebSocket-Origin: {origin}',
	'WebSocket-Location: {protocol}://{host}{resource}',
	'',
	''
].join("\r\n");

WebSocket.HANDSHAKE_TEMPLATE_76 = [
	'HTTP/1.1 101 WebSocket Protocol Handshake', // note a diff here
	'Upgrade: WebSocket',
	'Connection: Upgrade',
	'Sec-WebSocket-Origin: {origin}',
	'Sec-WebSocket-Location: {protocol}://{host}{resource}',
	'',
	'{data}'
].join("\r\n");


WebSocket.prototype.handshake = function(data)
{
//console.log("handshake"); 
	var _headers = data.split("\r\n");

	if ( /<policy-file-request.*>/.exec(_headers[0]) ) {
//console.log("policy-file-request: ", _headers[0]);
		this.socket.write(this.serverInstance.options.flashPolicy);
		try { this.end(); } catch(e) { console.log('error closing socket due to policy-file-request write error: ', this.version, e); }
		return;
	}

	// go to more convenient hash form
	var headers = {}, upgradeHead, len = _headers.length;

//console.log(' _headers[0]',  _headers[0]);

	if ( _headers[0].match(/^GET /) ) {
		headers["get"] = _headers[0];
	} else {
		try { this.end(); } catch(e) { console.log('expected a GET Header on handshake: ', this.version, e); }
		return;
	}

	if ( _headers[ _headers.length - 1 ] ) { // TODO is it valid for all drafts?
		upgradeHead = _headers[ _headers.length - 1 ];
		len--;
	}

	while (--len) // _headers[0] will be skipped
	{
		var header = _headers[len];
		if (!header) continue;

		var split = header.split(": ", 2); // second parameter actually seems to not work in node
		headers[ split[0].toLowerCase() ] = split[1];
	}

	// detect draft version
	this.version = WebSocketHelper.detectVersion(headers, upgradeHead);

//console.log('handshake: detected version', this.version);

	// extract headers
	var data = {}, match;
	for (var header in WebSocket.REQUIRED_HEADERS)
	{
	//           regexp                          actual header value
		if ( match = WebSocket.REQUIRED_HEADERS[header].exec(headers[header]) ) {
			data[header] = match;
		} else if (this.version != 'draft10') {
//console.log('required header not found', header);
			try { this.end(); } catch(e) { console.log("error terminating socket on required headers validation", this.version, e); }
			return;
		}
	}

	this.write = this.old_write;
	this.handle = this.old_handle;

	switch(this.version)
	{
		case 'draft10': 
			this.write = this.draft10_write;
			this.handle = this.draft10_handle;
			this.draft10_handshake(headers); 
			break;

		case 'draft76': this.draft76_handshake(headers, data, upgradeHead); break;
		case 'draft75': this.draft75_handshake(data); break;
	}

	this.handshaked = true;
	this.emitter.emit("connect", data.get[1]);
};

WebSocket.prototype.draft10_handshake = function(headers)
{
	var key = crypto.createHash('sha1');
	key.update(headers['sec-websocket-key']);
	key.update('258EAFA5-E914-47DA-95CA-C5AB0DC85B11'); // magic string

	var res = '';
	res += 'HTTP/1.1 101 Switching Protocols\r\n' +
		'Upgrade: WebSocket\r\n' +
		'Connection: Upgrade\r\n' +
		'Sec-WebSocket-Accept: ' + key.digest('base64') + '\r\n' +
		'\r\n';

	this.socket.write(res, 'binary');
};

WebSocket.prototype.draft76_handshake = function(headers, data, upgradeHead)
{
	var strkey1 = headers['sec-websocket-key1'],
		strkey2 = headers['sec-websocket-key2'],
		numkey1 = parseInt(strkey1.replace(/[^\d]/g, ''), 10),
		numkey2 = parseInt(strkey2.replace(/[^\d]/g, ''), 10),
		spaces1 = strkey1.replace(/[^\ ]/g, '').length,
		spaces2 = strkey2.replace(/[^\ ]/g, '').length;

	if (spaces1 == 0 || spaces2 == 0 || numkey1 % spaces1 != 0 || numkey2 % spaces2 != 0) {
		try { this.end(); } catch(e) { console.log('error closing socket due draft76_handshake trouble: ', this.version, e); }
		return;
	}

	var hash = crypto.createHash('md5'),
		key1 = WebSocketHelper.pack(parseInt(numkey1 / spaces1)),
		key2 = WebSocketHelper.pack(parseInt(numkey2 / spaces2));

	hash.update(key1);
	hash.update(key2);
	hash.update(upgradeHead);

	var handshakeResponse = WebSocketHelper.nano(WebSocket.HANDSHAKE_TEMPLATE_76, {
		protocol: this.serverInstance.protocol,
		resource: data.get[1],
		host:     data.host[1],
		origin:   data.origin[1],
		data:     hash.digest("binary")
	});
//console.log("handshakeResponse for draft 76", handshakeResponse, this.serverInstance);
	this.socket.write(handshakeResponse, "binary");
};

WebSocket.prototype.draft75_handshake = function(data)
{
	this.socket.write(WebSocketHelper.nano(WebSocket.HANDSHAKE_TEMPLATE_75, {
		protocol: this.serverInstance.protocol,
		resource: data.get[1],
		host:     data.host[1],
		origin:   data.origin[1]
	}));
};
