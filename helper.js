
WebSocketHelper = {};

WebSocketHelper.nano = function(template, data) {
	return template.replace(/\{([\w\.]*)}/g, function (str, key) {
		var keys = key.split("."), value = data[keys.shift()];
		keys.forEach(function (key) { value = value[key];});
		return value;
	});
}

WebSocketHelper.pack = function(num) {
	var result = '';
	result += String.fromCharCode(num >> 24 & 0xFF);
	result += String.fromCharCode(num >> 16 & 0xFF);
	result += String.fromCharCode(num >> 8 & 0xFF);
	result += String.fromCharCode(num & 0xFF);
	return result;
}


WebSocketHelper.detectVersion = function(headers, upgradeHead) // change upgradeHead
{
	if (headers['sec-websocket-version'])
		return 'draft10'; // assume that future versions will be supported - actually it should report that it processes up to draft17
/*
		if (headers['sec-websocket-version'] == '8') // draft10
			version = 'draft10';
		else if (headers['sec-websocket-version'] == '13') // draft17
			version = 'draft10';
*/

	if (headers["sec-websocket-key1"] && headers["sec-websocket-key2"] && upgradeHead) // draft76
		return 'draft76';

	return 'draft75';
};
