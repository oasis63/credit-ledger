// Metro config: lets the app import the shared package (../../packages/shared),
// which lives outside this folder and is linked via a file: dependency.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../../packages/shared');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
// The shared package has no dependencies of its own; anything it might import
// resolves from this app's node_modules, so there is one copy of React.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
