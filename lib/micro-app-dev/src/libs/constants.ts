export enum ObservedAttrName {
  NAME = 'name',
  URL = 'url',
}

// app status
export enum appStates {
  CREATED = 'created',
  LOADING = 'loading',
  LOADED = 'loaded',
  LOAD_FAILED = 'load_failed',
  MOUNTING = 'mounting',
  MOUNTED = 'mounted',
  UNMOUNT = 'unmount',
}

// lifecycles
export enum lifeCycles {
  CREATED = 'created',
  BEFOREMOUNT = 'beforemount',
  MOUNTED = 'mounted',
  UNMOUNT = 'unmount',
  ERROR = 'error',
  // 👇 keep-alive only
  BEFORESHOW = 'beforeshow',
  AFTERSHOW = 'aftershow',
  AFTERHIDDEN = 'afterhidden',
}

// keep-alive status
export enum keepAliveStates {
  KEEP_ALIVE_SHOW = 'keep_alive_show',
  KEEP_ALIVE_HIDDEN = 'keep_alive_hidden',
}

/**
 * global key must be static key, they can not rewrite
 * e.g.
 * window.Promise = newValue
 * new Promise ==> still get old value, not newValue, because they are cached by top function
 * NOTE:
 * 1. Do not add fetch, XMLHttpRequest, EventSource
 */
export const globalKeyToBeCached = 'window,self,globalThis,Array,Object,String,Boolean,Math,Number,Symbol,Date,Function,Proxy,WeakMap,WeakSet,Set,Map,Reflect,Element,Node,Document,RegExp,Error,TypeError,JSON,isNaN,parseFloat,parseInt,performance,console,decodeURI,encodeURI,decodeURIComponent,encodeURIComponent,navigator,undefined,location,history'
