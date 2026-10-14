/* @refresh reload */
import { render } from 'solid-js/web';

import 'virtual:uno.css';
import App from './App';

const root = document.querySelector('#root');

if (!(root instanceof HTMLElement)) {
  throw new TypeError(
    'Root element not found. Did you forget to add it to your index.html? Or maybe the id attribute got misspelled?',
  );
}

render(() => <App />, root);
