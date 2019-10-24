/**
 * Script to export JSON to closure externs
 */
'use strict';

const common = require('../lib/common.js');
const prefix = ' *';
const formatPrefix = '\n * ';

const invalidTypeMap = {
	'2DMatrix': '["2DMatrix"]',
	'3DMatrix': '["3DMatrix"]'
};

/**
 * @return {string}
 */
const join = function () {
	return this.join.call(arguments, ' ');
}.bind(Array.prototype);

/**
 * @param {string} text string to format
 * @return {string}
 */
function formatLinebreak(text) {
	if (text) {
		return text.split('\n').join(formatPrefix);
	}
	return '';
}

/**
 * @param {Object<string, string>} since object define then this feature was added
 * @return {string}
 */
function formatSince(since) {
	const temp = [];

	if (!since) {
		return '';
	}
	for (const platform in since) {
		temp.push(since[platform] + ' (' + common.PRETTY_PLATFORM[platform] + ')');
	}
	return join(prefix, '@since', temp.join(', '));
}

/**
 * @param {string|Array<string>} type object type|types
 * @param {boolean=} optional define if object optional
 * @param {boolean=} repeatable define if object repeatable
 * @return {*}
 */
function formatType(type, optional, repeatable) {
	if (!type) {
		return '';
	}
	let returnType = type;
	if (typeof returnType.join === 'function') {
		returnType = returnType.join('|');
	}
	returnType = returnType.replace(/Dictionary<(.*)\.(.*)>/g, '$1._Dictionary_$2');
	return [
		(repeatable ? '...' : ''), returnType, (optional ? '=' : '')
	].join('');
}

/**
 * @param {Object} cls api object
 * @return {string}
 */
function formatTypeDef(cls) {
	const temp = [];
	const prototypeDef = [];
	let className = cls.name;

	temp.push('/**');
	if (cls.summary) {
		temp.push(join(prefix, formatLinebreak(cls.summary)));
	}
	if (cls.properties) {
		for (let i = 0, l = cls['properties'].length; i < l; i++) {
			const property = cls['properties'][i];
			const propertyType = formatType(property.type);
			prototypeDef.push(join(
				prefix, ' ', property.name + ':',
				(propertyType.indexOf('|') !== -1 ? ('(' + propertyType + ')') : propertyType)
			));
			temp.push(join(prefix, '-', property.name, formatLinebreak(property.summary)));
		}
	}

	temp.push(join(prefix, '@typedef', '{{'));
	if (prototypeDef.length) {
		temp.push(prototypeDef.join(',\n'));
	}
	temp.push(join(prefix, '}}'));
	temp.push(' */');
	if (className.indexOf('.') === -1) {
		className = 'var ' + className;
	}
	temp.push(className + ' = {};');
	temp.push('');
	return temp.join('\n');
}

/**
 * @param {Object} cls api object
 * @param {Array} prototypeDef parameters in prototype
 * @return {string}
 */
function formatProperties(cls, prototypeDef) {
	const temp = [];
	const tt = [];
	let clsName;
	let readOnly = false;

	if (cls.name === 'Global') {
		clsName = 'var ';
	} else {
		clsName = cls.name + '.';
	}
	for (let i = 0, l = cls['properties'].length; i < l; i++) {
		const property = cls['properties'][i];
		temp.push('/**');
		temp.push(join(prefix, formatLinebreak(property.summary)));
		temp.push(formatSince(property['since']));
		const propertyType = formatType(property.type);
		readOnly = false;
		if (property.permission === 'read-only') {
			temp.push(join(prefix, '@readonly'));
			readOnly = true;
		}
		temp.push(join(
			prefix, '@type', '{' + propertyType + '}', property.name
		));
		temp.push(' */');
		if (property.name === property.name.toUpperCase()) {
			temp.push(clsName + property.name + ';');
		} else {
			temp.push(clsName + 'prototype.' + property.name + ';');
			if (!readOnly) {
				tt.push(join(
					prefix,
					' ',
					property.name + ':',
					(propertyType.indexOf('|') !== -1 ? ('(' + propertyType + ')') : propertyType)
				));
			}
		}
		temp.push('');
	}
	if (tt.length) {
		let tempClass;
		if (cls.extends) {
			tempClass = cls.extends.split('.');
			tempClass[tempClass.length - 1] = '_Dictionary_' + tempClass[tempClass.length - 1];
		}
		prototypeDef.push('/**');
		prototypeDef.push(join(prefix, '@typedef', '{{'));
		prototypeDef.push(tt.join(',\n'));
		prototypeDef.push(join(prefix, '}}'));
		prototypeDef.push(' */');
		const name = cls.name.replace('["', '.').replace('"]', '');
		tempClass = name.split('.');
		tempClass[tempClass.length - 1] = '_Dictionary_' + tempClass[tempClass.length - 1];
		if (tempClass.length === 1) {
			tempClass[tempClass.length - 1] = 'var ' + tempClass[tempClass.length - 1];
		}
		prototypeDef.push(tempClass.join('.') + ';');
		prototypeDef.push('');
	}
	return temp.join('\n');
}

/**
 * Format api methods
 * @param {Object} cls api object
 * @return {string}
 */
function formatMethods(cls) {
	const temp = [];
	let nsPrefix;

	if (cls.name.indexOf('Global') === 0) {
		nsPrefix = cls.name.substring(7);
		if (nsPrefix.length) {
			nsPrefix += '.';
		} else {
			nsPrefix = 'var ';
		}
	} else {
		nsPrefix = cls.name + '.';
	}
	for (let i = 0, l = cls['methods'].length; i < l; i++) {
		const method = cls['methods'][i];
		temp.push('/**');
		temp.push(join(prefix, formatLinebreak(method.summary)));
		temp.push(formatSince(method['since']));
		const header = [];
		if (cls.__creatable) {
			header.push(nsPrefix + 'prototype.' + method.name);
		} else {
			header.push(nsPrefix + method.name);
		}
		const params = [];
		if (method.parameters) {
			for (let k = 0; k < method.parameters.length; k++) {
				const parameter = method.parameters[k];
				let name = parameter.name;
				if (common.RESERVED_KEYWORDS.indexOf(name) !== -1) {
					name += '_';
				}
				params.push(name);
				temp.push(join(
					prefix, '@param',
					'{' + formatType(
						parameter.type,
						parameter.optional,
						parameter.repeatable
					) + '}',
					name,
					formatLinebreak(parameter.summary)
				));
			}
		}
		if (method.returns && method.returns.length) {
			let returnType = method.returns[0].type;
			if (typeof returnType.join === 'function') {
				returnType = returnType.join('|');
			}
			temp.push([
				prefix,
				'@return',
				'{' + formatType(method.returns[0].type) + '}'
			].join(' '));
		}
		header.push('= function(' + params.join(', ') + ') {};');
		temp.push(' */');
		temp.push(header.join(' '));
		temp.push('');
	}
	return temp.join('\n');
}

/**
 * Returns a string with js API description
 * @param {Object} apis full api tree
 * @return {string}
 */
exports.exportData = function exportGCEXTERNS(apis) {
	let jsdoc = [
		'/**',
		' * @fileoverview Generated externs.  DO NOT EDIT!',
		' * @externs',
		' */',
		''
	];

	common.log(common.LOG_INFO, 'Generating closure externs...');

	const names = Object.keys(apis).sort();

	for (let i = 0, l = names.length; i < l; i++) {
		const cls = apis[names[i]];
		const protoDict = [];

		if (cls.__subtype === 'pseudo') {
			jsdoc.push(formatTypeDef(cls));
		} else {
			jsdoc.push('/**');
			if (cls.summary) {
				jsdoc.push(join(prefix, formatLinebreak(cls.summary)));
			}
			if (cls.__creatable) {
				jsdoc.push(join(prefix, '@constructor'));
			}
			if (cls.extends) {
				jsdoc.push(join(prefix, '@extends', '{' + cls.extends + '}'));
			}
			if (cls.description) {
				jsdoc.push(join(prefix, '@description', formatLinebreak(cls.description)));
			}
			if (cls.since) {
				jsdoc.push(formatSince(cls['since']));
			}
			jsdoc.push(' */');
			let name = cls.name;
			if (name.indexOf('Global') === 0) {
				if (name[6] === '.') {
					name = name.substring(7);
				} else {
					name = '';
				}
			}
			if (name) {
				if (name.indexOf('.') !== -1) {
					const typeName = name.substring(name.lastIndexOf('.') + 1);
					if (invalidTypeMap[typeName]) {
						name = name.replace('.' + typeName, invalidTypeMap[typeName]);
						cls.name = name;
					}
				} else {
					if (invalidTypeMap[name]) {
						name = invalidTypeMap[name];
						cls.name = name;
					}
					name = 'var ' + name;
				}
				jsdoc.push(join(name, '= function() {};'));
			}
			if (cls.properties) {
				jsdoc.push('');
				jsdoc.push(formatProperties(cls, protoDict));
			}
			if (cls.methods) {
				jsdoc.push('');
				jsdoc.push(formatMethods(cls));
			}
		}
		jsdoc.push('');
		if (protoDict.length) {
			jsdoc = jsdoc.concat(protoDict);
		}
	}
	jsdoc.push('var Ti = Titanium;');
	return jsdoc.join('\n');
};
