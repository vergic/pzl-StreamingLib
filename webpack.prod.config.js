const path = require('path');
const helpers = require('./webpack.helpers');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    'pzlStreamLib': './src/VngageStream.js',
    'pzlStreamLib.deps': './src/VngageStream_deps.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].min.js',
    library: {
      name: 'pzlStreamLib',
      type: 'umd',
      export: 'default',
    },
    globalObject: 'this',
    umdNamedDefine: true,
  },
  target: ['web', 'es5'],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        use: [
          {
            loader: 'babel-loader',
            options: {}
          }
        ],
        exclude: /node_modules/
      }, {
        // Rule for transpiling js in selected "node_modules" (some modules are not distributed in es5)
        // We want a different config for those (e.g. without "babel-preset-react", etc)
        test: /\.jsx?$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              cacheDirectory: true,
            }
          }
        ],
        // List node_modules to transpile (most do NOT require transpiling, as they are already es5...)
        include: helpers.includeNodeModules(['@microsoft\\signalr'])
      },
    ]
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        // Remove comments and license-file generation
        terserOptions: {
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
};
