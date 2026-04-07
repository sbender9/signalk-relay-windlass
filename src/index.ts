/*
 * Copyright 2025 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// <reference types="node" />

import { ServerAPI, Plugin, Path, ActionResult } from '@signalk/server-api'

enum WindlassState {
  Up = 'up',
  Off = 'off',
  Down = 'down'
}

const error: ActionResult = {
  state: 'COMPLETED',
  statusCode: 500
}

const completed: ActionResult = {
  state: 'COMPLETED',
  statusCode: 200
}

const pending: ActionResult = {
  state: 'PENDING'
}

const start = (app: any) => {
  let props: any
  let onStop: any = []
  let started = false
  let restartPlugin: any = null
  let upRelayState = false
  let downRelayState = false
  let currentState: WindlassState = WindlassState.Off
  let timeoutTimer: NodeJS.Timeout | null = null

  function clearTimeoutTimer() {
    if (timeoutTimer) {
      app.debug('Clearing windlass timeout timer')
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  function forceWindlassOff() {
    app.debug('Windlass timeout reached - forcing off')
    clearTimeoutTimer()

    // Turn off both relays
    app.debug('Forcing relay states: up=false, down=false')
    app.putSelfPath(props.upRelayPath, false)
    app.putSelfPath(props.downRelayPath, false)

    // Send notification about timeout
    const timeoutNotification = {
      updates: [
        {
          values: [
            {
              path: 'notifications.windlass.timeout',
              value: {
                state: 'alert',
                method: ['visual', 'sound'],
                message: `Windlass automatically stopped after ${props.timeoutSeconds} seconds`,
                timestamp: new Date().toISOString()
              }
            }
          ]
        }
      ]
    }
    app.handleMessage(plugin.id, timeoutNotification)
  }

  function updateWindlassState() {
    if (!started) return

    let newState: WindlassState
    if (upRelayState && !downRelayState) {
      newState = WindlassState.Up
    } else if (!upRelayState && downRelayState) {
      newState = WindlassState.Down
    } else {
      newState = WindlassState.Off
    }

    // Handle timeout logic
    if (newState !== currentState) {
      app.debug(
        `Windlass state changing: ${currentState} -> ${newState} (up: ${upRelayState}, down: ${downRelayState})`
      )
      clearTimeoutTimer()

      // Start timeout timer for active states
      if (
        (newState === WindlassState.Up || newState === WindlassState.Down) &&
        props.timeoutSeconds > 0
      ) {
        app.debug(`Starting timeout timer: ${props.timeoutSeconds} seconds`)
        timeoutTimer = setTimeout(() => {
          forceWindlassOff()
        }, props.timeoutSeconds * 1000)
      }

      currentState = newState
      sendState(newState)
    }
  }

  const plugin: Plugin = {
    start: (properties: any, restartPluginParam) => {
      restartPlugin = restartPluginParam
      props = properties
      started = true

      app.debug('Starting windlass plugin with configuration:')
      app.debug(`  windlassPath: ${props.windlassPath}`)
      app.debug(`  upRelayPath: ${props.upRelayPath}`)
      app.debug(`  downRelayPath: ${props.downRelayPath}`)
      app.debug(`  timeoutSeconds: ${props.timeoutSeconds}`)

      const subscriptionOptions = {
        context: 'vessels.self',
        subscribe: [
          {
            path: props.upRelayPath,
            period: 100
          },
          {
            path: props.downRelayPath,
            period: 100
          }
        ]
      }

      app.debug('Setting up subscriptions for relay monitoring')
      const subscription = app.subscriptionmanager.subscribe(
        subscriptionOptions,
        onStop,
        (error: any) => {
          app.error('Subscription error: ' + JSON.stringify(error))
        },
        (delta: any) => {
          delta.updates?.forEach((update: any) => {
            update.values?.forEach((value: any) => {
              if (value.path === props.upRelayPath) {
                app.debug(
                  `Up relay state changed: ${upRelayState} -> ${Boolean(value.value)}`
                )
                upRelayState = Boolean(value.value)
                updateWindlassState()
              } else if (value.path === props.downRelayPath) {
                app.debug(
                  `Down relay state changed: ${downRelayState} -> ${Boolean(value.value)}`
                )
                downRelayState = Boolean(value.value)
                updateWindlassState()
              }
            })
          })
        }
      )

      app.debug('Registering PUT handler for windlass control')
      app.registerPutHandler(
        'vessels.self',
        props.windlassPath,
        (context: string, path: string, value: any, cb: any) => {
          app.debug(`PUT request received: ${path} = ${value}`)
          if (value === WindlassState.Up) {
            app.debug('Processing windlass UP command')
            setWindlassUp(cb)
            return pending
          } else if (value === WindlassState.Down) {
            app.debug('Processing windlass DOWN command')
            setWindlassDown(cb)
            return pending
          } else if (value === WindlassState.Off) {
            app.debug('Processing windlass OFF command')
            setWindlassOff(cb)
            return pending
          } else {
            app.debug(`Unknown windlass command: ${value}`)
            return error
          }
        }
      )

      app.handleMessage(plugin.id, {
        updates: [
          {
            meta: [
              {
                path: props.windlassPath as Path,
                value: {
                  displayName: 'Windlass',
                  possibleValues: [
                    {
                      title: 'Up',
                      value: 'up'
                    },
                    {
                      title: 'Off',
                      value: 'off'
                    },
                    {
                      title: 'Down',
                      value: 'down'
                    }
                  ]
                }
              }
            ]
          }
        ]
      })

      sendState(WindlassState.Off)
      app.debug('Windlass plugin started successfully')
    },

    stop: function () {
      app.debug('Stopping windlass plugin')
      started = false
      clearTimeoutTimer()
      onStop.forEach((f: any) => f())
      onStop = []
      app.debug('Windlass plugin stopped')
    },

    id: 'signalk-relay-windlass',
    name: 'Signal K Relay Windlass',
    description:
      'Signal K Plugin to control a windlass using two relay switches',

    schema: {
      type: 'object',
      required: ['windlassPath', 'upRelayPath', 'downRelayPath'],
      properties: {
        windlassPath: {
          type: 'string',
          title: 'Windlass State Path',
          description: 'The path to use for the windlass state',
          default: 'electrical.windlass.control.state'
        },
        upRelayPath: {
          type: 'string',
          title: 'Up Relay Path',
          description: 'The path to the up relay switch',
          default: 'electrical.windlass.up.state'
        },
        downRelayPath: {
          type: 'string',
          title: 'Down Relay Path',
          description: 'The path to the down relay switch',
          default: 'electrical.windlass.down.state'
        },
        timeoutSeconds: {
          type: 'number',
          title: 'Safety Timeout (seconds)',
          description:
            'Maximum time windlass can run continuously before automatic shutoff (0 = no timeout)',
          default: 10
        },
        switchingDelaySeconds: {
          type: 'number',
          title: 'Direction Switch Delay (seconds)',
          description:
            'Delay when switching between up and down directions (0 = no delay)',
          default: 5
        }
      }
    }

    /*
    uiSchema: () => {
      const uiSchema: any = {}

      Object.values(devices).forEach((device: any) => {
        uiSchema[`Device ID ${deviceKey(device)}`] = {
          password: {
            'ui:widget': 'password'
          }
        }
      })

      return uiSchema
    },
    */

    //registerWithRouter: (router) => {}
  }

  function sendState(state: WindlassState) {
    app.debug(`Sending windlass state: ${state}`)
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: props.windlassPath as Path,
              value: state
            }
          ]
        }
      ]
    })
  }

  function setWindlassUp(cb: any) {
    app.debug('Executing windlass UP: turning off down relay first')
    app.putSelfPath(props.downRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode === 200) {
          app.debug('Down relay turned off, now turning on up relay')
          setTimeout(() => {
            app.putSelfPath(props.upRelayPath, true, (reply: any) => {
              if (reply.state === 'COMPLETED') {
                if (reply.statusCode === 200) {
                  app.debug('Up relay activated successfully')
                  sendState(WindlassState.Up)
                  cb(completed)
                } else {
                  app.debug(`Up relay activation failed: ${reply.statusCode}`)
                  cb({ ...error, message: reply.message })
                }
              }
            })
          }, currentState === WindlassState.Down ? props.switchingDelaySeconds * 1000 : 0)
        } else {
          app.debug(`Up relay PUT failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
        }
      }
    })
  }

  function setWindlassDown(cb: any) {
    app.debug('Executing windlass DOWN: turning off up relay first')
    app.putSelfPath(props.upRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode === 200) {
          app.debug('Up relay turned off, now turning on down relay')
          setTimeout(() => {
            app.putSelfPath(props.downRelayPath, true, (reply: any) => {
              if (reply.state === 'COMPLETED') {
                if (reply.statusCode === 200) {
                  app.debug('Down relay activated successfully')
                  sendState(WindlassState.Down)
                  cb(completed)
                } else {
                  app.debug(`Down relay activation failed: ${reply.statusCode}`)
                  cb({ ...error, message: reply.message })
                }
              }
            })
          }, currentState === WindlassState.Up ? props.switchingDelaySeconds * 1000 : 0)
        } else {
          app.debug(`Up relay deactivation failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
        }
      }
    })
  }

  function setWindlassOff(cb: any) {
    app.debug('Executing windlass OFF: turning off both relays')
    app.putSelfPath(props.upRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode !== 200) {
          app.debug(`Up relay deactivation failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
          return
        }
        app.debug('Up relay turned off, now turning off down relay')
        app.putSelfPath(props.downRelayPath, false, (reply: any) => {
          if (reply.state === 'COMPLETED') {
            if (reply.statusCode === 200) {
              app.debug('Both relays turned off successfully')
              sendState(WindlassState.Off)
              cb(completed)
            } else {
              app.debug(`Down relay deactivation failed: ${reply.statusCode}`)
              cb({ ...error, message: reply.message })
            }
          }
        })
      }
    })
  }

  return plugin
}

module.exports = start
export default start
