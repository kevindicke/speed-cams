import { registerRootComponent } from 'expo';

// Registers the background location task at startup — must load before the app renders.
import './src/locationTask';
import App from './App';

registerRootComponent(App);
