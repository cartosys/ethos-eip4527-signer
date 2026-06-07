const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot  = __dirname;
const monorepoRoot = path.resolve(__dirname, '..');

const config = {
  // Watch only the library source, not the full monorepo root.
  // Watching monorepoRoot directly causes Metro to scan the pnpm virtual store
  // (.pnpm/ symlink tree), which hangs Metro startup.
  watchFolders: [
    path.resolve(monorepoRoot, 'src'),
  ],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
    ],
    // @env is a virtual module whose imports are replaced by react-native-dotenv's
    // Babel plugin at transform time. Metro must resolve it to a real file first;
    // envStub.js is that placeholder — its exports are never actually used.
    extraNodeModules: {
      '@env': path.resolve(projectRoot, 'envStub.js'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
