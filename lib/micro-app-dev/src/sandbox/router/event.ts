import type { MicroLocation } from '@micro-app/types'
import { appInstanceMap } from '../../create_app'
import { getActiveApps } from '../../micro_app'
import { formatEventName } from '../effect'
import { getMicroPathFromURL, getMicroState } from './core'
import { updateMicroLocation } from './location'
import globalEnv from '../../libs/global_env'
import { removeDomScope, isFunction } from '../../libs/utils'

type PopStateListener = (this: Window, e: PopStateEvent) => void
type MicroPopStateEvent = PopStateEvent & { onlyForBrowser?: boolean }

/**
 * dispatch PopStateEvent & HashChangeEvent to child app
 * each child app will listen for popstate event when sandbox start
 * and release it when sandbox stop
 * @param appName app name
 * @returns release callback
 */
export function addHistoryListener (appName: string): CallableFunction {
  const rawWindow = globalEnv.rawWindow
  // handle popstate event and distribute to child app
  const popStateHandler: PopStateListener = (e: MicroPopStateEvent): void => {
    /**
     * 1. unmount app & hidden keep-alive app will not receive popstate event
     * 2. filter out onlyForBrowser
     */
    if (getActiveApps(true).includes(appName) && !e.onlyForBrowser) {
      const microPath = getMicroPathFromURL(appName)
      const app = appInstanceMap.get(appName)!
      const proxyWindow = app.sandBox!.proxyWindow
      let isHashChange = false
      // for hashChangeEvent
      const oldHref = proxyWindow.location.href
      // Do not attach micro state to url when microPath is empty
      if (microPath) {
        const oldHash = proxyWindow.location.hash
        updateMicroLocation(appName, microPath, proxyWindow.location as MicroLocation)
        isHashChange = proxyWindow.location.hash !== oldHash
      }

      // dispatch formatted popStateEvent to child
      dispatchPopStateEventToMicroApp(appName, proxyWindow)

      // dispatch formatted hashChangeEvent to child when hash change
      if (isHashChange) dispatchHashChangeEventToMicroApp(appName, proxyWindow, oldHref)

      // clear element scope before trigger event of next app
      removeDomScope()
    }
  }

  rawWindow.addEventListener('popstate', popStateHandler)

  return () => {
    rawWindow.removeEventListener('popstate', popStateHandler)
  }
}

/**
 * dispatch formatted popstate event to microApp
 * @param appName app name
 * @param proxyWindow sandbox window
 * @param eventState history.state
 */
export function dispatchPopStateEventToMicroApp (
  appName: string,
  proxyWindow: WindowProxy,
): void {
  // create PopStateEvent named popstate-appName with sub app state
  const newPopStateEvent = new PopStateEvent(
    formatEventName('popstate', appName),
    { state: getMicroState(appName) }
  )

  /**
   * angular14 takes e.type as type judgment
   * when e.type is popstate-appName popstate event will be invalid
   */
  // Object.defineProperty(newPopStateEvent, 'type', {
  //   value: 'popstate',
  //   writable: true,
  //   configurable: true,
  //   enumerable: true,
  // })

  globalEnv.rawWindow.dispatchEvent(newPopStateEvent)

  // call function window.onpopstate if it exists
  isFunction(proxyWindow.onpopstate) && proxyWindow.onpopstate(newPopStateEvent)
}

/**
 * dispatch formatted hashchange event to microApp
 * @param appName app name
 * @param proxyWindow sandbox window
 * @param oldHref old href
 */
export function dispatchHashChangeEventToMicroApp (
  appName: string,
  proxyWindow: WindowProxy,
  oldHref: string,
): void {
  const newHashChangeEvent = new HashChangeEvent(
    formatEventName('hashchange', appName),
    {
      newURL: proxyWindow.location.href,
      oldURL: oldHref,
    }
  )

  globalEnv.rawWindow.dispatchEvent(newHashChangeEvent)

  // call function window.onhashchange if it exists
  isFunction(proxyWindow.onhashchange) && proxyWindow.onhashchange(newHashChangeEvent)
}

/**
 * dispatch native PopStateEvent, simulate location behavior
 * @param onlyForBrowser only dispatch PopStateEvent to browser
 */
function dispatchNativePopStateEvent (onlyForBrowser: boolean): void {
  const event = new PopStateEvent('popstate', { state: null }) as MicroPopStateEvent
  if (onlyForBrowser) event.onlyForBrowser = true
  globalEnv.rawWindow.dispatchEvent(event)
}

/**
 * dispatch hashchange event to browser
 * @param oldHref old href of rawWindow.location
 */
function dispatchNativeHashChangeEvent (oldHref: string): void {
  const newHashChangeEvent = new HashChangeEvent(
    'hashchange',
    {
      newURL: globalEnv.rawWindow.location.href,
      oldURL: oldHref,
    }
  )

  globalEnv.rawWindow.dispatchEvent(newHashChangeEvent)
}

/**
 * dispatch popstate & hashchange event to browser
 * @param onlyForBrowser only dispatch event to browser
 * @param oldHref old href of rawWindow.location
 */
export function dispatchNativeEvent (onlyForBrowser: boolean, oldHref?: string): void {
  // clear element scope before dispatch global event
  removeDomScope()
  dispatchNativePopStateEvent(onlyForBrowser)
  if (oldHref) {
    dispatchNativeHashChangeEvent(oldHref)
  }
}
