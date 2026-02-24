const path = require('path');

module.exports = {
  mode: 'development',
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
    filename: '[name].js',
    library: {
      type: 'module',
    },
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
  devtool: "source-map",
};
