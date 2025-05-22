const prodBrowserConfig = require('./webpack.prod.browser.config');
const prodNodeConfig = require('./webpack.prod.node.config');

module.exports = [
    prodBrowserConfig,
    prodNodeConfig
];
