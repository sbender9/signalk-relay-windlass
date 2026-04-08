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

import {
  ServerAPI,
  Plugin,
  Path,
  ActionResult,
  Context,
  MetaValue
} from '@signalk/server-api'

import path from 'path'
import fs from 'fs'

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

const start = (app: ServerAPI) => {
  let props: any
  let onStop: any = []
  let started = false
  let upRelayState = false
  let downRelayState = false
  let currentState: WindlassState = WindlassState.Off
  let timeoutTimer: NodeJS.Timeout | null = null
  let lastChainUpdate: number = Date.now() // Last time chain counter was updated
  let chainCounterUpdateTimer: NodeJS.Timeout | null = null // Timer for continuous chain counter updates
  let notificationResetTimer: NodeJS.Timeout | null = null // Timer for resetting timeout notification
  let statePath: string | null = null
  let state: any = null

  // External control state tracking for chain counter
  let externalUpState = false
  let externalDownState = false
  let externalCurrentState: WindlassState = WindlassState.Off

  function clearTimeoutTimer() {
    if (timeoutTimer) {
      app.debug('Clearing windlass timeout timer')
      clearTimeout(timeoutTimer)
      timeoutTimer = null
    }
  }

  function clearChainCounterUpdateTimer() {
    if (chainCounterUpdateTimer) {
      app.debug('Clearing chain counter update timer')
      clearTimeout(chainCounterUpdateTimer)
      chainCounterUpdateTimer = null
    }
  }

  function clearNotificationResetTimer() {
    if (notificationResetTimer) {
      app.debug('Clearing notification reset timer')
      clearTimeout(notificationResetTimer)
      notificationResetTimer = null
    }
  }

  function startChainCounterContinuousUpdates() {
    // Only start continuous updates if chain counter is enabled
    if (!props.chainRateFeetPerMinute || props.chainRateFeetPerMinute <= 0) {
      return
    }

    // Don't start timer if already running
    if (chainCounterUpdateTimer) {
      return
    }

    const updateInterval = 1000 // Fixed 1 second interval
    app.debug('Starting chain counter continuous updates every 1 second')

    chainCounterUpdateTimer = setInterval(() => {
      // Update chain counter based on the appropriate active state
      // Priority: external control takes precedence if any external path is active
      const externalActive = externalCurrentState !== WindlassState.Off
      const activeState = externalActive ? externalCurrentState : currentState

      updateChainCounter(activeState, activeState)
      // Send current chain counter value
      sendChainCounterUpdate()
    }, updateInterval)
  }

  function stopChainCounterContinuousUpdates() {
    if (chainCounterUpdateTimer) {
      app.debug('Stopping chain counter continuous updates')
      clearChainCounterUpdateTimer()
    }
  }

  function sendChainCounterUpdate() {
    if (!props.chainCounterPath) return

    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: props.chainCounterPath as Path,
              value: state.chainOut * 0.3048 // Convert feet to meters
            }
          ]
        }
      ]
    })
  }

  function updateChainCounter(
    newState: WindlassState,
    oldState: WindlassState
  ) {
    if (!props.chainRateFeetPerMinute || props.chainRateFeetPerMinute <= 0) {
      return // Chain counter disabled
    }

    const now = Date.now()

    // Calculate time since last update
    const deltaTime = (now - lastChainUpdate) / 1000 / 60 // Convert to minutes
    lastChainUpdate = now

    // Calculate chain movement based on old state
    let chainMovement = 0
    if (oldState === WindlassState.Up) {
      // Chain coming in (up) - negative movement
      chainMovement = -(deltaTime * props.chainRateFeetPerMinute)
    } else if (oldState === WindlassState.Down) {
      // Chain going out (down) - positive movement
      chainMovement = deltaTime * props.chainRateFeetPerMinute
    }

    // Update chain counter
    state.chainOut += chainMovement
    // Ensure chain out doesn't go negative
    state.chainOut = Math.max(0, state.chainOut)

    if (Math.abs(chainMovement) > 0.001) {
      // Only log significant changes
      app.debug(
        `Chain counter updated: ${chainMovement.toFixed(2)}ft movement, total out: ${state.chainOut.toFixed(2)}ft`
      )
    }

    saveState()

    // Send chain counter update to Signal K
    sendChainCounter()

    // Also send via continuous update if configured
    sendChainCounterUpdate()
  }

  function saveState() {
    if (!statePath) return
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
  }

  function sendChainCounter() {
    if (!props.chainCounterPath) return

    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: props.chainCounterPath as Path,
              value: state.chainOut * 0.3048
            }
          ]
        }
      ]
    })
  }

  function resetChainCounter() {
    app.debug('Resetting chain counter to 0')
    state.chainOut = 0
    saveState()
    sendChainCounter()
  }

  function forceWindlassOff() {
    app.debug('Windlass timeout reached - forcing off')
    clearTimeoutTimer()

    // Turn off both relays
    app.debug('Forcing relay states: up=false, down=false')
    ;(app as any).putSelfPath(props.upRelayPath, false)
    ;(app as any).putSelfPath(props.downRelayPath, false)

    // Send notification about timeout
    const timeoutNotification = {
      updates: [
        {
          values: [
            {
              path: 'notifications.windlass.timeout' as Path,
              value: {
                state: 'alert',
                method: ['visual', 'sound'],
                message: `Windlass automatically stopped after ${props.timeoutSeconds} seconds`
              }
            }
          ]
        }
      ]
    }
    app.handleMessage(plugin.id, timeoutNotification)

    // Set timer to reset notification to normal after 10 seconds
    clearNotificationResetTimer()
    app.debug('Setting timer to reset notification in 10 seconds')
    notificationResetTimer = setTimeout(() => {
      app.debug('Resetting windlass timeout notification to normal')
      const normalNotification = {
        updates: [
          {
            values: [
              {
                path: 'notifications.windlass.timeout' as Path,
                value: {
                  state: 'normal',
                  message: 'Windlass timeout cleared'
                }
              }
            ]
          }
        ]
      }
      app.handleMessage(plugin.id, normalNotification)
      notificationResetTimer = null
    }, 10000)
  }

  function updateExternalWindlassState() {
    if (!started) return

    // Only track external state for chain counter if enabled
    if (!props.chainRateFeetPerMinute || props.chainRateFeetPerMinute <= 0) {
      return
    }

    let newExternalState: WindlassState
    if (externalUpState && !externalDownState) {
      newExternalState = WindlassState.Up
    } else if (!externalUpState && externalDownState) {
      newExternalState = WindlassState.Down
    } else {
      newExternalState = WindlassState.Off
    }

    // Handle external windlass state change for chain counter
    if (newExternalState !== externalCurrentState) {
      app.debug(
        `External windlass state changing: ${externalCurrentState} -> ${newExternalState} (up: ${externalUpState}, down: ${externalDownState})`
      )

      // Update chain counter based on previous external state
      updateChainCounter(newExternalState, externalCurrentState)

      // Manage chain counter timer based on external state
      // External control takes precedence over relay control for continuous updates
      if (
        newExternalState === WindlassState.Up ||
        newExternalState === WindlassState.Down
      ) {
        startChainCounterContinuousUpdates()
      } else {
        // Only stop if relay control is also off
        if (currentState === WindlassState.Off) {
          stopChainCounterContinuousUpdates()
        }
      }

      externalCurrentState = newExternalState

      // Update overall windlass state (external takes precedence)
      updateOverallWindlassState()
    }
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

      // Update chain counter based on previous state
      updateChainCounter(newState, currentState)

      clearTimeoutTimer()

      // Manage chain counter timer based on state
      // Only stop continuous updates if both relay and external control are off
      if (newState === WindlassState.Up || newState === WindlassState.Down) {
        startChainCounterContinuousUpdates()
      } else {
        // Only stop if external control is also off
        if (externalCurrentState === WindlassState.Off) {
          stopChainCounterContinuousUpdates()
        }
      }

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

      // Update overall windlass state (external takes precedence if active)
      updateOverallWindlassState()
    }
  }

  const plugin: Plugin = {
    start: (properties: any, _restartPluginParam) => {
      props = properties
      started = true

      app.debug('Starting windlass plugin with configuration:')
      app.debug(`  windlassPath: ${props.windlassPath}`)
      app.debug(`  upRelayPath: ${props.upRelayPath}`)
      app.debug(`  downRelayPath: ${props.downRelayPath}`)
      app.debug(`  timeoutSeconds: ${props.timeoutSeconds}`)
      app.debug(`  chainRateFeetPerMinute: ${props.chainRateFeetPerMinute}`)
      app.debug(`  chainCounterPath: ${props.chainCounterPath}`)
      app.debug(`  chainCounterResetPath: ${props.chainCounterResetPath}`)
      app.debug(`  externalUpPath: ${props.externalUpPath}`)
      app.debug(`  externalDownPath: ${props.externalDownPath}`)

      if (app.getDataDirPath) {
        // for tests
        statePath = path.join(app.getDataDirPath(), 'state.json')
      }

      if (statePath != null && fs.existsSync(statePath)) {
        let stateString
        try {
          stateString = fs.readFileSync(statePath, 'utf8')
        } catch (e) {
          app.error('Could not read state ' + statePath + ' - ' + e)
          return
        }
        try {
          state = JSON.parse(stateString)
        } catch (e) {
          app.error('Could not parse state ' + e)
          return
        }
      } else {
        state = { chainOut: 0 }
      }

      // Initialize chain counter
      lastChainUpdate = Date.now()

      const subscriptionPaths: any[] = [
        {
          path: props.upRelayPath,
          period: 100
        },
        {
          path: props.downRelayPath,
          period: 100
        }
      ]

      // Add external control paths if configured
      if (props.externalUpPath && props.chainRateFeetPerMinute > 0) {
        subscriptionPaths.push({
          path: props.externalUpPath,
          period: 100
        })
        app.debug(
          `Added external up path subscription: ${props.externalUpPath}`
        )
      }

      if (props.externalDownPath && props.chainRateFeetPerMinute > 0) {
        subscriptionPaths.push({
          path: props.externalDownPath,
          period: 100
        })
        app.debug(
          `Added external down path subscription: ${props.externalDownPath}`
        )
      }

      const subscriptionOptions = {
        context: 'vessels.self' as Context,
        subscribe: subscriptionPaths
      }

      app.debug('Setting up subscriptions for relay monitoring')
      app.subscriptionmanager.subscribe(
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
              } else if (value.path === props.externalUpPath) {
                app.debug(
                  `External up control changed: ${externalUpState} -> ${Boolean(value.value)}`
                )
                externalUpState = Boolean(value.value)
                updateExternalWindlassState()
              } else if (value.path === props.externalDownPath) {
                app.debug(
                  `External down control changed: ${externalDownState} -> ${Boolean(value.value)}`
                )
                externalDownState = Boolean(value.value)
                updateExternalWindlassState()
              }
            })
          })
        }
      )

      // Register PUT handler for chain counter reset (if enabled)
      if (props.chainRateFeetPerMinute > 0 && props.chainCounterResetPath) {
        app.debug('Registering PUT handler for chain counter reset')
        app.registerPutHandler(
          'vessels.self',
          props.chainCounterResetPath,
          (context: string, path: string, value: any, cb: any) => {
            app.debug(
              `Chain counter reset request received: ${path} = ${value}`
            )
            if (value === true || value === 1) {
              resetChainCounter()
              cb(completed)
              app.handleMessage(plugin.id, {
                updates: [
                  {
                    values: [
                      {
                        path: props.chainCounterResetPath as Path,
                        value: false
                      }
                    ]
                  }
                ]
              })

              return completed
            } else {
              app.debug(`Invalid chain reset command: ${value}`)
              return error
            }
          }
        )
      }

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
                  ],
                  enum: [
                    {
                      displayName: 'Up',
                      value: 'up'
                    },
                    {
                      displayName: 'Off',
                      value: 'off'
                    },
                    {
                      displayName: 'Down',
                      value: 'down'
                    }
                  ]
                } as MetaValue
              }
            ]
          }
        ]
      })

      // Add chain counter metadata if enabled
      if (props.chainRateFeetPerMinute > 0 && props.chainCounterPath) {
        const metaEntries = [
          {
            path: props.chainCounterPath as Path,
            value: {
              displayName: 'Chain Out',
              description: 'Length of chain deployed in meters',
              units: 'm'
            } as MetaValue
          }
        ]

        // Add reset path metadata if configured
        if (props.chainCounterResetPath) {
          metaEntries.push({
            path: props.chainCounterResetPath as Path,
            value: {
              displayName: 'Reset Chain Counter',
              description: 'Reset chain counter to zero',
              units: 'bool'
            } as MetaValue
          })
        }

        app.handleMessage(plugin.id, {
          updates: [
            {
              meta: metaEntries
            }
          ]
        })
      }

      sendState(WindlassState.Off)

      // Send initial chain counter value
      if (props.chainRateFeetPerMinute > 0 && props.chainCounterPath) {
        sendChainCounter()

        app.handleMessage(plugin.id, {
          updates: [
            {
              values: [
                {
                  path: props.chainCounterResetPath as Path,
                  value: false
                }
              ]
            }
          ]
        })
      }

      app.debug('Windlass plugin started successfully')
    },

    stop: function () {
      app.debug('Stopping windlass plugin')
      started = false
      clearTimeoutTimer()
      clearChainCounterUpdateTimer()
      clearNotificationResetTimer()
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
          default: 1
        },
        chainRateFeetPerMinute: {
          type: 'number',
          title: 'Chain Rate (feet per minute)',
          description:
            'Rate at which chain is deployed/retrieved in feet per minute (0 = disable chain counter)',
          default: 60
        },
        chainCounterPath: {
          type: 'string',
          title: 'Chain Counter Path',
          description: 'Signal K path for chain out counter in feet',
          default: 'electrical.windlass.chainOut'
        },
        chainCounterResetPath: {
          type: 'string',
          title: 'Chain Counter Reset Path',
          description: 'Signal K path for chain counter reset command',
          default: 'electrical.windlass.chainCounterReset.state'
        },
        externalUpPath: {
          type: 'string',
          title: 'External Up Control Path (Optional)',
          description:
            'Signal K path for external windlass up control - used for chain counter tracking only',
          default: 'electrical.windlass.externalUp.state'
        },
        externalDownPath: {
          type: 'string',
          title: 'External Down Control Path (Optional)',
          description:
            'Signal K path for external windlass down control - used for chain counter tracking only',
          default: 'electrical.windlass.externalDown.state'
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

  // Determine and send the current overall windlass state
  // External control takes precedence over relay control
  function updateOverallWindlassState() {
    if (!started) return

    // External control takes precedence
    const overallState =
      externalCurrentState !== WindlassState.Off
        ? externalCurrentState
        : currentState
    app.debug(
      `Overall windlass state: ${overallState} (external: ${externalCurrentState}, relay: ${currentState})`
    )
    sendState(overallState)
  }

  function setWindlassUp(cb: any) {
    app.debug('Executing windlass UP: turning off down relay first')
    ;(app as any).putSelfPath(props.downRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode === 200) {
          app.debug('Down relay turned off, now turning on up relay')
          setTimeout(
            () => {
              ;(app as any).putSelfPath(
                props.upRelayPath,
                true,
                (reply: any) => {
                  if (reply.state === 'COMPLETED') {
                    if (reply.statusCode === 200) {
                      app.debug('Up relay activated successfully')
                      sendState(WindlassState.Up)
                      cb(completed)
                    } else {
                      app.debug(
                        `Up relay activation failed: ${reply.statusCode}`
                      )
                      cb({ ...error, message: reply.message })
                    }
                  }
                }
              )
            },
            currentState === WindlassState.Down
              ? props.switchingDelaySeconds * 1000
              : 0
          )
        } else {
          app.debug(`Up relay PUT failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
        }
      }
    })
  }

  function setWindlassDown(cb: any) {
    app.debug('Executing windlass DOWN: turning off up relay first')
    ;(app as any).putSelfPath(props.upRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode === 200) {
          app.debug('Up relay turned off, now turning on down relay')
          setTimeout(
            () => {
              ;(app as any).putSelfPath(
                props.downRelayPath,
                true,
                (reply: any) => {
                  if (reply.state === 'COMPLETED') {
                    if (reply.statusCode === 200) {
                      app.debug('Down relay activated successfully')
                      sendState(WindlassState.Down)
                      cb(completed)
                    } else {
                      app.debug(
                        `Down relay activation failed: ${reply.statusCode}`
                      )
                      cb({ ...error, message: reply.message })
                    }
                  }
                }
              )
            },
            currentState === WindlassState.Up
              ? props.switchingDelaySeconds * 1000
              : 0
          )
        } else {
          app.debug(`Up relay deactivation failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
        }
      }
    })
  }

  function setWindlassOff(cb: any) {
    app.debug('Executing windlass OFF: turning off both relays')
    ;(app as any).putSelfPath(props.upRelayPath, false, (reply: any) => {
      if (reply.state === 'COMPLETED') {
        if (reply.statusCode !== 200) {
          app.debug(`Up relay deactivation failed: ${reply.statusCode}`)
          cb({ ...error, message: reply.message })
          return
        }
        app.debug('Up relay turned off, now turning off down relay')
        ;(app as any).putSelfPath(props.downRelayPath, false, (reply: any) => {
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
