import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: './src-web/index.ts',
  deps: { alwaysBundle: /.+/, onlyBundle: false },
  dts: { oxc: true }
})