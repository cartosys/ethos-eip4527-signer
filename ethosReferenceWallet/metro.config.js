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
    // @env is a virtual module emitted by react-native-dotenv's Babel plugin.
    // Without this, Metro tries to resolve it from disk and fails.
    extraNodeModules: {
      '@env': path.resolve(projectRoot, 'node_modules/react-native-dotenv'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
