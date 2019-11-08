const common = require('../lib/common.js');
const GENERATE_TYPES_FOR_EVENTS = true;
const WRITE_INHERITANCE_OF_CLASSES = false;

const knownInterfaces = [
  'String',
  'JSON',
  'console'
];

function writeDefinitions(version, d) {
  const versionSplit = version.split('.');
  const majorMinor = `${versionSplit[0]}.${versionSplit[1]}`;
  return `// Type definitions for non-npm package Titanium ${majorMinor}
// Project: https://github.com/appcelerator/titanium_mobile
// Definitions by: Sergey Volkov <s.volkov@netris.ru>

type Dictionary<T> = Partial<Omit<T, Extract<keyof T, Function>>>

${d}
import Ti = Titanium;
`;
}

function getType(type) {
  if (typeof type === 'string') {
    if (type.includes('2DMatrix')) {
      type = type.replace('2DMatrix', 'Matrix2D');
    }
    if (type.includes('3DMatrix')) {
      type = type.replace('3DMatrix', 'Matrix3D');
    }
  }
  switch (type) {
    case 'Boolean':
    case 'Function':
    case 'Number':
    case 'String':
      return type.toLowerCase();
    case 'Object':
      return 'any';
    case 'Callback':
    case 'Callback<Object>':
    case 'Callback<Dictionary>':
      return '(...args: any[]) => void';
    case 'Dictionary':
      return 'any';
    case 'Array<Dictionary>':
      return 'Array<any>';
    default:
      if (typeof type === 'object') {
        if (typeof type[0] === 'object') {
          return getType(type[0]);
        }
        if (typeof type.type !== 'undefined') {
          return getType(type.type);
        }
        return Object.values(type).map(v => getType(v)).join('|')
      } else if (type.startsWith('Callback')) {
        return type.replace(/^Callback<(.*)>$/, formatCallback);
      } else {
        return type;
      }
  }
}

function formatCallback(match, p1) {
  const args = p1
      .split(',')
      .map((a, i) => {
        a = a.trim();
        if (a === 'Object') {
          a = 'any'
        }
        return `arg${i + 1}: ${a}`
      })
      .join(', ');
  return `(${args}) => void`
}

function getValidName(name) {
  if (common.RESERVED_KEYWORDS.includes(name)) {
    name += '_';
  }
  return name;
}

function deepExtend(from, to) {
  Object.keys(from).forEach(key => {
    if (key === 'global') {
      return;
    }
    if (typeof from[key] !== 'object' || from[key] === null) {
      to[key] = from[key];
    } else {
      if (!to[key]) {
        to[key] = {};
      }
      deepExtend(from[key], to[key]);
    }
  });
}

function formatRemoved(pad, methodOrProperty, comment) {
  const notes = methodOrProperty.deprecated.notes ? methodOrProperty.deprecated.notes.replace('\n', `\n${pad} *`) : '';
  return `${pad}/*\n` +
      `${pad} * REMOVED in ${methodOrProperty.deprecated.removed}\n` +
      `${pad} * ${notes}\n` +
      `${pad} */\n` +
      `${pad}${comment ? '// ' : ''}${methodOrProperty.name}: never;`
}

function propertyToString(pad, property, allMethodsNames, classOrInterface) {
  if (property.deprecated && property.deprecated.removed) {
    return formatRemoved(pad, property, allMethodsNames.includes(property.name));
  }
  let opt = false;
  if (classOrInterface === 'interface') {
    opt = true;
  }
  return `${pad}${property.permission === 'read-only' ? 'readonly ': ''}${property.name}${
    opt ? '?' : ''}: ${getType(property.type)};`
}

function methodToString(pad, method, allPropertiesNames, eventsEnumName, thisName) {
  if (method.deprecated && method.deprecated.removed) {
    return formatRemoved(pad, method, allPropertiesNames.includes(method.name));
  }
  if (GENERATE_TYPES_FOR_EVENTS && eventsEnumName) {
    if (method.name === 'addEventListener') {
      return `${pad}${method.name}(name: keyof typeof ${eventsEnumName}, callback: (this: ${thisName}, ...args: any[]) => any): void;`;
    } else if (method.name === 'removeEventListener') {
      return `${pad}${method.name}(name: keyof typeof ${eventsEnumName}, callback: (...args: any[]) => any): void;`;
    } else if (method.name === 'fireEvent') {
      return `${pad}${method.name}(name: keyof typeof ${eventsEnumName}, ...args: any[]): void;`;
    }
  }
  const args = methodArgumentsToString(method.parameters).join(', ');
  return `${pad}${method.name}(${args}): ${methodResultToString(method)};`
}

function methodArgumentsToString(parameters) {
  if (!parameters) {
    return [];
  }
  const keys = Object.values(parameters);
  if (!keys.length) {
    return [];
  }
  return keys.map(v => {
    const name = getValidName(v.name);
    const type = getType(v.type);
    let optional = '';
    if (type.indexOf('Dictionary') === 0 && keys.length === 1) {
      optional = '?'
    }
    return `${name}${optional}: ${type}`;
  })
}

function methodResultToString(method) {
  return method.returns && Object.keys(method.returns).length ? getType(method.returns) : 'void';
}


function excludesToString(pad, excludesSet, prefix) {
  let temp = [];
  if (excludesSet.size) {
    excludesSet.forEach(v => temp.push(`${pad}${prefix ? prefix : ''}${v}: never;`));
    temp.push('');
  }
  return temp.join('\n');
}

class Block {
  constructor(params) {
    this._baseName =  params.baseName;
    this._padding = params.padding;
    this._inGlobal = params.inGlobal;
    this._global = params.global;

    this.api = {};

    /** @type {Array<Block>} */
    this.childBlocks = [];
    this.childBlocksMap = {};
  }
  formatClassOrInterface() {
    this.prepareExcludes();
    const padding = `${this._padding}\t`;
    const methods = Object.values(this.api.methods);
    const properties = Object.values(this.api.properties);

    const allMethodsNames = methods.map(v => v.name);
    const allPropertiesNames = properties.map(v => v.name);
    let eventsEnum;
    let eventsEnumName;

    let inner = '';

    if (GENERATE_TYPES_FOR_EVENTS) {
      if (this.api.events && Object.keys(this.api.events)) {
        const events = new Set(Object.values(this.api.events).map(e => e.name));
        if (this.api.excludes && this.api.excludes.events) {
          Object.values(this.api.excludes.events).forEach(event => events.delete(event));
        }
        if (events.size) {
          eventsEnumName = `${this._baseName}Events`;
          eventsEnum = `${this._padding}enum ${eventsEnumName} {\n` +
              Array.from(events).map(e => `${padding}\t'${e}'`).join(',\n') +
              `\n${this._padding}}\n`
        }
      }
    }
    let dec = '';
    let classOrInterface = 'class';
    if (this._inGlobal) {
      dec = 'declare ';
      if (knownInterfaces.includes(this._baseName)) {
        classOrInterface = 'interface';
      }
      if (this.api.__subtype === 'pseudo' && !this.api.__creatable) {
        classOrInterface = 'interface';
      }
    }

    if (properties.length) {
      inner += `${padding}// ${this.api.name} properties\n`;
      inner += excludesToString(padding, this.all_excludes['properties']);
      inner += properties.map(v => propertyToString(padding, v, allMethodsNames, classOrInterface)).join('\n') + '\n';
    }
    if (methods.length) {
      inner += `${padding}// ${this.api.name} methods\n`;
      inner += excludesToString(padding, this.all_excludes['methods']);
      inner += methods.map(v => methodToString(padding, v, allPropertiesNames, eventsEnumName, this.api.name)).join('\n') + `\n`;
    }
    let ext = '';
    if (WRITE_INHERITANCE_OF_CLASSES && this.api.extends) {
      ext = `extends ${this.api.extends} `;
    }

    let result = `${this._padding}${dec}${classOrInterface} ${this._baseName} ${ext}{\n${inner}${this._padding}}\n`;
    if (eventsEnum) {
      result = eventsEnum + result;
    }
    return result;
  }
  formatNamespace() {
    let inner = this.childBlocks.map(block => block.toString()).join('');
    if (this === this._global) {
      return  inner;
    }
    this.prepareExcludes();
    const padding = `${this._padding}\t`;
    const methods = Object.values(this.api.methods);
    const properties = Object.values(this.api.properties);

    if (methods.length) {
      inner = excludesToString(padding, this.all_excludes['methods'], 'const ') +
          methods.map(v => {
            const args = methodArgumentsToString(v.parameters).join(', ');
            return `${padding}function ${v.name}(${args}): ${methodResultToString(v)};`
          }).join('\n') + '\n' + inner;
    }
    if (properties.length) {
      const apiName = this.api.name;
      inner = excludesToString(padding, this.all_excludes['properties']) +
          properties.map(v => {
            let prefix = 'let';
            if (v.permission === 'read-only') {
              prefix = 'const';
            }
            const result = `${prefix} ${v.name}: ${getType(v.type)};`;
            if (v.name === 'R' && (apiName === 'Titanium.Android' || apiName === 'Titanium.App.Android')) {
              return `${padding}// Skip. Redeclare block-scoped variable.\n${padding}//${result}`;
            }
            return `${padding}${result}`;
          }).join('\n') + '\n' + inner;
    }

    return `${this._padding}${this._inGlobal ? 'declare ': ''}namespace ${this._baseName} {\n${inner}${this._padding}}\n`
  }
  prepareExcludes() {
    const methodProperties = ['methods', 'properties'];
    if (!this.api.excludes) {
      this.api.excludes = {
        methods: {},
        properties: {}
      };
    } else {
      this.api.excludes.methods = this.api.excludes.methods || {};
      this.api.excludes.properties = this.api.excludes.properties || {};
    }
    this.all_excludes = {};
    methodProperties.forEach(key => this.all_excludes[key] = new Set(Object.values(this.api.excludes[key])));
    if (this.api.extends) {
      let parent = this._global;
      const path = this.api.extends.split('.');
      do {
        let namespaceName = path.shift();
        parent = parent.getOrCreateBlock(namespaceName);
      } while (path.length > 0);
      if (parent.api.excludes) {
        if (!parent.__excludesReady) {
          parent.prepareExcludes();
        }
        methodProperties.forEach(key => {
          parent.all_excludes[key].forEach(v => {
            if (!this.all_excludes[key].has(v)) {
              this.all_excludes[key].add(v);
            }
          });
        });
      }
    }
    methodProperties.forEach(key => this.removeExcluded(key));
    this.__excludesReady = true;
  }
  toString() {
    if (!isNaN(parseInt(this._baseName[0], 10)) || this._baseName === 'Dictionary') {
      return `${this._padding}// #Skip incorrect identifier "${this._baseName}";\n`;
    }
    let result = '';

    if (typeof this.api.__subtype !== 'undefined' && ['proxy', 'view'].includes(this.api.__subtype)) {
      result += this.formatClassOrInterface();
    } else if (this.childBlocks.length) {
      result += this.formatNamespace();
    } else {
      result += this.formatClassOrInterface();
    }
    return result;
  }
  getOrCreateBlock(name) {
    if (typeof this.childBlocksMap[name] !== 'undefined') {
      return this.childBlocks[this.childBlocksMap[name]];
    }
    const inGlobal = this._global === this;
    const padding = inGlobal ? '' : this._padding + '\t';
    const tempBlock = new Block({baseName: name, padding: padding, inGlobal: inGlobal, global: this._global});
    this.childBlocksMap[name] = this.childBlocks.length;
    this.childBlocks.push(tempBlock);
    return tempBlock;
  }
  add(name, api) {
    this.getOrCreateBlock(name).update(api);
  }
  update(api) {
    deepExtend(api, this.api);
  }
  removeExcluded(container) {
    if (this.all_excludes) {
      if (this.all_excludes[container] && this.all_excludes[container].size) {
        Object.keys(this.api[container]).forEach(key => {
          const name = this.api[container][key].name;
          if (this.all_excludes[container].has(name)) {
            delete this.api[container][key];
          }
        });
      }
    }
  }
}

function createBlock(global, api) {
  if (typeof api !== 'object' || api === null) {
    return;
  }
  const name = api.name;
  let parent = global;
  if (name === global._baseName) {
    global.update(api);
    return;
  }
  const path = name.split('.');
  let namespaceName = path.shift();
  if (namespaceName === global._baseName) {
    namespaceName = path.shift();
  }
  while (path.length > 0) {
    parent = parent.getOrCreateBlock(namespaceName);
    namespaceName = path.shift();
  }

  parent.add(namespaceName, api);
}

function createGlobal() {
  const block = new Block({baseName: 'Global', padding: ''});
  block._global = block;
  return block;
}

/**
 * Returns a string with js API description
 * @param {Object} apis full api tree
 * @return {string}
 */
exports.exportData = function exportDTS(apis) {
  common.log(common.LOG_INFO, 'Generating typescript definitions file...');

  const global = createGlobal();
  for (const fullyQualifiedTypeName in apis) {
    createBlock(global, apis[fullyQualifiedTypeName]);
  }
  return writeDefinitions(apis.__version, global.toString());
};
