import type { CthApi } from './index';

declare global {
  interface Window {
    cth: CthApi;
  }
}

export {};
