var path = require('path')

module.exports = {
  entry: path.join(__dirname, '/index.js'),
  externals: {
    crypto: 'crypto'
  },
  output: {
    library: 'mvc',
    path: path.join(__dirname, '/'),
    filename: 'mvc.min.js'
  },
  mode: 'production'
}
