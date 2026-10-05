import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 콘솔에 등록한 appName과 같아야 해요
  appName: 'petpet-cat',

  brand: {
    primaryColor: '#FF91D5'
  },

  permissions: [],
  webBundleDir: 'dist'
});
