// Lets Node resolve the app's extensionless imports ('./layout') to .ts files.
import { registerHooks } from 'node:module'
registerHooks({
  resolve(spec, ctx, next) {
    try { return next(spec, ctx) } catch (e) {
      if (/^\.\.?\//.test(spec) && !/\.\w+$/.test(spec)) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
