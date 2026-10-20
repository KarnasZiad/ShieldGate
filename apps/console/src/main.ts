import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { configureApi, createApi } from './lib/api';
import { createAppRouter } from './router';
import { useSessionStore } from './stores/session';
import './style.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const session = useSessionStore(pinia);
const router = createAppRouter();

configureApi(
  createApi({
    csrfToken: () => session.csrfToken,
    // A revoked or expired session sends the administrator back to the login page.
    onUnauthorized: () => {
      if (session.authenticated) {
        session.reset();
        void router.push({
          path: '/login',
          query: { redirect: router.currentRoute.value.fullPath },
        });
      }
    },
  }),
);

app.use(router);
app.mount('#app');
