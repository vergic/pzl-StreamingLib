const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'production',
  entry: {
    'pzl-stream-lib': './src/PzlStream.js',
  },
  externalsType: "module",
  externals: {
    "@microsoft/signalr": "@microsoft/signalr",
  },
  experiments: {
    outputModule: true,
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].min.js',
    library: {
      type: 'module',
    }
  },
  target: ['web', 'es2015'],
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
