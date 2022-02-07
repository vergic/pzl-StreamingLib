const fs = require('fs');
const path = require('path');

// Helper-function for use in rule include to include specific node_modules in babel-loader (that need transpiling)
const includeNodeModules = (includeModulesArray) => {
	const pathSep = (path.sep === '\\' ? '\\\\' : path.sep);	// Backslash must be quoted for use in a regexp
	const moduleRegExps = includeModulesArray.map(modName => new RegExp('node_modules' + pathSep + modName.replaceAll('\\', '\\\\')));

	return (modulePath) => {
		// Return a function that tests if the module <modulePath> is a node_module which should be included or not
		if (/node_modules/.test(modulePath)) {
			// The module is a node-module...
			for (let i = 0; i < moduleRegExps.length; i++) {
				if (moduleRegExps[i].test(modulePath)) {
					// ...and the module matches an item in the "includeModulesArray"-array: Include it!
					return true;
				}
			}
		}

		// If we get here: The module it either not a node_module, or it has not matched any item in "includeModulesArray": Don't include...
		return false;
	};
};

module.exports = {
	includeNodeModules
};
