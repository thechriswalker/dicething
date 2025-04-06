// does the equivalent of JSON.stringify(), without stringifying
export function toJSON(obj: any): any {
	return _toJSON(obj);
}

function _toJSON(o: any): any {
	if ('toJSON' in o && typeof o.toJSON === 'function') {
		return o.toJSON();
	}
	if (Array.isArray(o)) {
		return o.map((v) => _toJSON(v));
	}
	if (typeof o === 'object') {
		return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, _toJSON(v)]));
	}
	return o;
}
