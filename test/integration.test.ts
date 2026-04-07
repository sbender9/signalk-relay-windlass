import { expect } from 'chai'
import { describe, it, beforeEach, afterEach } from 'mocha'
import windlassPlugin from '../src/index'

// Minimal mock for integration testing
class IntegrationMockAPI {
  public messages: any[] = []
  public putHandlers: Map<string, Function> = new Map()
  public relayStates: Map<string, boolean> = new Map()
  public subscribeCallback: Function | null = null

  debug() {}
  error() {}

  handleMessage(pluginId: string, message: any) {
    this.messages.push(message)
  }

  subscriptionmanager = {
    subscribe: (
      options: any,
      onStop: any[],
      errorCallback: Function,
      deltaCallback: Function
    ) => {
      this.subscribeCallback = deltaCallback
    }
  }

  registerPutHandler(context: string, path: string, handler: Function) {
    this.putHandlers.set(path, handler)
  }

  putSelfPath(path: string, value: any, callback?: Function) {
    this.relayStates.set(path, Boolean(value))

    // Trigger subscription to update internal state
    if (
      (path.includes('relay') || path.includes('.state')) &&
      this.subscribeCallback
    ) {
      this.subscribeCallback({
        updates: [
          {
            values: [
              {
                path: path,
                value: Boolean(value)
              }
            ]
          }
        ]
      })
    }

    if (callback) {
      setTimeout(() => callback({ state: 'COMPLETED', statusCode: 200 }), 1)
    }
  }
}

describe('Windlass Plugin Integration Tests', () => {
  let mockApp: IntegrationMockAPI
  let plugin: any

  beforeEach(() => {
    mockApp = new IntegrationMockAPI()
    plugin = windlassPlugin(mockApp)
  })

  afterEach(() => {
    if (plugin && plugin.stop) {
      plugin.stop()
    }
  })

  describe('Complete Anchoring Workflow', () => {
    it('should handle complete anchor deployment workflow', (done) => {
      const config = {
        windlassPath: 'electrical.windlass.control.state',
        upRelayPath: 'electrical.windlass.up.state',
        downRelayPath: 'electrical.windlass.down.state',
        timeoutSeconds: 30,
        switchingDelaySeconds: 0, // Disable delay for test speed
        chainRateFeetPerMinute: 120, // 2 feet per second
        chainCounterPath: 'navigation.anchor.chainOut',
        chainCounterResetPath: 'navigation.anchor.chainOut.reset'
      }

      plugin.start(config, () => {})

      const windlassHandler = mockApp.putHandlers.get(config.windlassPath)
      const resetHandler = mockApp.putHandlers.get(config.chainCounterResetPath)

      // Step 1: Reset chain counter
      resetHandler('vessels.self', config.chainCounterResetPath, true, () => {
        // Step 2: Deploy anchor (down)
        windlassHandler('vessels.self', config.windlassPath, 'down', () => {
          setTimeout(() => {
            // Step 3: Stop windlass
            windlassHandler('vessels.self', config.windlassPath, 'off', () => {
              // Verify chain counter shows deployment
              const chainMessages = mockApp.messages.filter(
                (m) =>
                  m.updates?.[0]?.values?.[0]?.path === config.chainCounterPath
              )
              expect(chainMessages.length).to.be.greaterThan(1)

              const lastChainValue =
                chainMessages[chainMessages.length - 1].updates[0].values[0]
                  .value
              expect(lastChainValue).to.be.greaterThan(0)

              done()
            })
          }, 500) // Deploy for 0.5 seconds
        })
      })
    }).timeout(2000)

    it('should handle anchor retrieval workflow', (done) => {
      const config = {
        windlassPath: 'electrical.windlass.control.state',
        upRelayPath: 'electrical.windlass.up.state',
        downRelayPath: 'electrical.windlass.down.state',
        timeoutSeconds: 30,
        switchingDelaySeconds: 0,
        chainRateFeetPerMinute: 120,
        chainCounterPath: 'navigation.anchor.chainOut',
        chainCounterResetPath: 'navigation.anchor.chainOut.reset'
      }

      plugin.start(config, () => {})

      const windlassHandler = mockApp.putHandlers.get(config.windlassPath)

      // First deploy some chain
      windlassHandler('vessels.self', config.windlassPath, 'down', () => {
        setTimeout(() => {
          windlassHandler('vessels.self', config.windlassPath, 'off', () => {
            // Get chain amount after deployment
            const deployMessages = mockApp.messages.filter(
              (m) =>
                m.updates?.[0]?.values?.[0]?.path === config.chainCounterPath
            )
            const deployedAmount =
              deployMessages[deployMessages.length - 1].updates[0].values[0]
                .value

            // Now retrieve chain
            windlassHandler('vessels.self', config.windlassPath, 'up', () => {
              setTimeout(() => {
                windlassHandler(
                  'vessels.self',
                  config.windlassPath,
                  'off',
                  () => {
                    // Check final chain amount
                    const finalMessages = mockApp.messages.filter(
                      (m) =>
                        m.updates?.[0]?.values?.[0]?.path ===
                        config.chainCounterPath
                    )
                    const finalAmount =
                      finalMessages[finalMessages.length - 1].updates[0]
                        .values[0].value

                    // Should be less than deployed amount
                    expect(finalAmount).to.be.lessThan(deployedAmount)
                    done()
                  }
                )
              }, 300) // Retrieve for 0.3 seconds
            })
          })
        }, 500) // Deploy for 0.5 seconds
      })
    }).timeout(3000)
  })

  describe('Error Handling', () => {
    it('should handle missing configuration gracefully', () => {
      const invalidConfig = {
        windlassPath: 'electrical.windlass.control.state'
        // Missing required paths
      }

      expect(() => plugin.start(invalidConfig, () => {})).to.not.throw()
    })

    it('should handle chain counter disabled configuration', () => {
      const config = {
        windlassPath: 'electrical.windlass.control.state',
        upRelayPath: 'electrical.windlass.up.state',
        downRelayPath: 'electrical.windlass.down.state',
        timeoutSeconds: 30,
        chainRateFeetPerMinute: 0, // Disabled
        chainCounterPath: 'navigation.anchor.chainOut',
        chainCounterResetPath: 'navigation.anchor.chainOut.reset'
      }

      plugin.start(config, () => {})

      // Should have windlass handler but not chain counter reset handler
      expect(mockApp.putHandlers.has(config.windlassPath)).to.be.true
      expect(mockApp.putHandlers.has(config.chainCounterResetPath)).to.be.false
    })
  })

  describe('Plugin Lifecycle', () => {
    it('should start and stop cleanly multiple times', () => {
      const config = {
        windlassPath: 'electrical.windlass.control.state',
        upRelayPath: 'electrical.windlass.up.state',
        downRelayPath: 'electrical.windlass.down.state',
        timeoutSeconds: 30,
        chainRateFeetPerMinute: 60,
        chainCounterPath: 'navigation.anchor.chainOut',
        chainCounterResetPath: 'navigation.anchor.chainOut.reset'
      }

      // Start and stop multiple times
      for (let i = 0; i < 3; i++) {
        expect(() => plugin.start(config, () => {})).to.not.throw()
        expect(() => plugin.stop()).to.not.throw()
      }
    })

    it('should handle stop before start', () => {
      expect(() => plugin.stop()).to.not.throw()
    })
  })
})
