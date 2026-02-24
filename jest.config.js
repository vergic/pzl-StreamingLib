/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js', '!src/PzlStream.js'],
  coverageDirectory: 'coverage',
  transformIgnorePatterns: [
    // Transform stately.js (may need Babel) but not most node_modules
    'node_modules/(?!(stately\\.js)/)',
  ],
};
