/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './src/App'; // Confirme que o caminho para seu App.tsx está correto
import {name as appName} from './app.json';

AppRegistry.registerComponent(appName, () => App);