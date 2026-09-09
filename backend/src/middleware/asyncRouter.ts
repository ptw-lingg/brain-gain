// Express 4 ignores the promise an async handler returns: a rejection becomes an unhandledRejection,
// which Node ≥ 15 turns into a process exit — one throwing request takes every user down, and the
// client that caused it just sees a reset connection. `asyncRouter()` is a drop-in for `Router()`
// whose registration methods forward a rejected (or thrown) handler to next(err), so the failure
// reaches the JSON error middleware in index.ts like a synchronous one would.
//
// Error-handling middleware (arity 4) is left untouched: Express identifies it BY arity, and the
// wrapper would change that. Every route module uses asyncRouter(); scormServer.ts wraps its one
// handler with wrapAsync() directly because it builds an express() app, not a Router.

import { Router, type RouterOptions } from 'express';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any handler signature must fit
type AnyFn = (...args: any[]) => unknown;

export function wrapAsync<F extends AnyFn>(fn: F): F {
  if (fn.length >= 4) return fn; // error middleware — its arity is its contract
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const next = args[2] as ((err?: unknown) => void) | undefined;
    let result: unknown;
    try {
      result = fn.apply(this, args);
    } catch (err) {
      if (typeof next !== 'function') throw err;
      next(err);
      return undefined;
    }
    if (result instanceof Promise && typeof next === 'function') {
      result.catch(next);
      return undefined; // Express ignores the return value; a handled promise must not leak out
    }
    return result;
  };
  return wrapped as unknown as F;
}

function wrapArg(arg: unknown): unknown {
  if (typeof arg === 'function') return wrapAsync(arg as AnyFn);
  if (Array.isArray(arg)) return arg.map(wrapArg);
  return arg; // a path string, a regex, a Router
}

const METHODS = ['use', 'all', 'get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

/** A Router whose handlers may be async: a rejection reaches the error middleware, never the process. */
export function asyncRouter(options?: RouterOptions): Router {
  const router = Router(options);
  const target = router as unknown as Record<string, AnyFn>;
  for (const method of METHODS) {
    const original = target[method];
    target[method] = function (...args: unknown[]): unknown {
      return original.apply(router, args.map(wrapArg));
    };
  }
  return router;
}
