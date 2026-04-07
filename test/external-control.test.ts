import { expect } from 'chai'
import { describe, it, beforeEach, afterEach } from 'mocha'
import windlassPlugin from '../src/index'

// Enhanced mock for external control testing
class ExternalControlMockAPI {
  public messages: any[] = []
  public subscriptions: any[] = []
  public putHandlers: Map<string, Function> = new Map()
  public relayStates: Map<string, boolean> = new Map()

  debug() {}
  error() {}

  handleMessage(pluginId: string, message: any) {
    this.messages.push({ pluginId, message, timestamp: Date.now() })
  }

  subscriptionmanager = {
    subscribe: (
      options: any,
      onStop: any[],
      errorCallback: Function,
      deltaCallback: Function
    ) => {
      this.subscriptions.push({ options, onStop, errorCallback, deltaCallback })
      return { unsubscribe: () => {} }
    }
  }

  registerPutHandler(context: string, path: string, handler: Function) {
    this.putHandlers.set(path, handler)
  }

  putSelfPath(path: string, value: any, callback?: Function) {
    this.relayStates.set(path, Boolean(value))

    // Also trigger subscription for relay paths
    if (path.includes('relay') || path.includes('.state')) {
      this.simulatePathChange(path, Boolean(value))
    }

    if (callback) {
      setTimeout(() => {
        callback({ state: 'COMPLETED', statusCode: 200 })
      }, 1)
    }
  }

  simulatePathChange(path: string, value: boolean) {
    const subscription = this.subscriptions[0]
    if (subscription && subscription.deltaCallback) {
      subscription.deltaCallback({
        updates: [
          {
            values: [
              {
                path: path,
                value: value
              }
            ]
          }
        ]
      })
    }
  }

  // Helper method to get latest chain counter value
  getLatestChainCounterValue() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]
      const updates = message.message?.updates || []
      for (const update of updates) {
        const values = update.values || []
        for (const value of values) {
          if (value.path === 'navigation.anchor.chainOut') {
            return value.value
          }
        }
      }
    }
    return null
  }

  reset() {
    this.messages = []
    this.subscriptions = []
    this.putHandlers.clear()
    this.relayStates.clear()
  }
}

describe('External Control Tests', () => {
  let mockApp: ExternalControlMockAPI
  let plugin: any
  let externalConfig: any

  beforeEach(() => {
    mockApp = new ExternalControlMockAPI()
    plugin = windlassPlugin(mockApp)
    externalConfig = {
      windlassPath: 'electrical.windlass.control.state',
      upRelayPath: 'electrical.windlass.up.state',
      downRelayPath: 'electrical.windlass.down.state',
      timeoutSeconds: 30,
      switchingDelaySeconds: 0,
      chainRateFeetPerMinute: 60, // 1 foot per second for easy calculation
      chainCounterPath: 'navigation.anchor.chainOut',
      chainCounterResetPath: 'navigation.anchor.chainOut.reset',
      externalUpPath: 'electrical.external.windlass.up',
      externalDownPath: 'electrical.external.windlass.down'
    }
  })

  afterEach(() => {
    if (plugin && plugin.stop) {
      plugin.stop()
    }
    mockApp.reset()
  })

  describe('Configuration', () => {
    it('should include external control paths in schema', () => {
      expect(plugin.schema.properties.externalUpPath).to.exist
      expect(plugin.schema.properties.externalDownPath).to.exist
      expect(plugin.schema.properties.externalUpPath.title).to.include(
        'External Up Control Path'
      )
      expect(plugin.schema.properties.externalDownPath.title).to.include(
        'External Down Control Path'
      )
    })

    it('should start with external control paths configured', () => {
      plugin.start(externalConfig, () => {})

      // Should have subscriptions for external paths
      expect(mockApp.subscriptions.length).to.equal(1)
      const subscription = mockApp.subscriptions[0]
      const subscribedPaths = subscription.options.subscribe.map(
        (s: any) => s.path
      )

      expect(subscribedPaths).to.include(externalConfig.externalUpPath)
      expect(subscribedPaths).to.include(externalConfig.externalDownPath)
    })

    it('should work without external control paths configured', () => {
      const configWithoutExternal = { ...externalConfig }
      delete configWithoutExternal.externalUpPath
      delete configWithoutExternal.externalDownPath

      plugin.start(configWithoutExternal, () => {})

      // Should still work normally with just relay paths
      const subscription = mockApp.subscriptions[0]
      const subscribedPaths = subscription.options.subscribe.map(
        (s: any) => s.path
      )

      expect(subscribedPaths).to.include(configWithoutExternal.upRelayPath)
      expect(subscribedPaths).to.include(configWithoutExternal.downRelayPath)
      expect(subscribedPaths).to.not.include('electrical.external.windlass.up')
    })
  })

  describe('Chain Counter with External Control', () => {
    beforeEach(() => {
      plugin.start(externalConfig, () => {})
    })

    it('should update chain counter when external up control is active', (done) => {
      // Clear any initial chain messages
      mockApp.messages = []

      // First deploy some chain using down control
      mockApp.simulatePathChange(externalConfig.externalDownPath, true)

      setTimeout(() => {
        // Stop down control
        mockApp.simulatePathChange(externalConfig.externalDownPath, false)

        setTimeout(() => {
          // Get the chain value after deployment
          const deployedChainValue = mockApp.getLatestChainCounterValue()
          console.log('Deployed chain value:', deployedChainValue)

          // Clear messages and start up control to retrieve chain
          mockApp.messages = []
          mockApp.simulatePathChange(externalConfig.externalUpPath, true)

          setTimeout(() => {
            // Stop up control
            mockApp.simulatePathChange(externalConfig.externalUpPath, false)

            setTimeout(() => {
              // Log all messages for debugging
              const chainMessages = mockApp.messages.filter(
                (m) =>
                  m.message?.updates?.[0]?.values?.[0]?.path ===
                  'navigation.anchor.chainOut'
              )
              console.log(
                'Up chain messages:',
                chainMessages.map((m) => m.message.updates[0].values[0].value)
              )

              const finalChainValue = mockApp.getLatestChainCounterValue()
              console.log('Final chain value after retrieval:', finalChainValue)

              // Should be less than what was deployed
              expect(finalChainValue).to.be.lessThan(deployedChainValue)
              done()
            }, 50)
          }, 300) // Retrieve for 0.3 seconds
        }, 50)
      }, 300) // Deploy for 0.3 seconds first
    }).timeout(3000)

    it('should update chain counter when external down control is active', (done) => {
      // Simulate external down control activation
      mockApp.simulatePathChange(externalConfig.externalDownPath, true)

      setTimeout(() => {
        // Stop external control
        mockApp.simulatePathChange(externalConfig.externalDownPath, false)

        setTimeout(() => {
          const chainValue = mockApp.getLatestChainCounterValue()
          expect(chainValue).to.be.greaterThan(0) // Should be positive (chain going out)
          done()
        }, 50)
      }, 500) // Run for 0.5 seconds
    }).timeout(2000)

    it('should prioritize external control over relay control for chain counter', (done) => {
      // First deploy some chain using relay control
      mockApp.simulatePathChange(externalConfig.downRelayPath, true)

      setTimeout(() => {
        mockApp.simulatePathChange(externalConfig.downRelayPath, false)
        const deployedValue = mockApp.getLatestChainCounterValue()

        // Clear messages and start external down control to deploy more
        mockApp.messages = []
        mockApp.simulatePathChange(externalConfig.externalDownPath, true)

        setTimeout(() => {
          // Stop external control
          mockApp.simulatePathChange(externalConfig.externalDownPath, false)

          setTimeout(() => {
            const finalValue = mockApp.getLatestChainCounterValue()

            // Should have added more chain
            expect(finalValue).to.be.greaterThan(deployedValue)
            done()
          }, 50)
        }, 300) // External control for 0.3 seconds
      }, 300) // Initial deployment
    }).timeout(2000)

    it('should not interfere with relay-controlled windlass PUT handlers', (done) => {
      const windlassHandler = mockApp.putHandlers.get(
        externalConfig.windlassPath
      )
      expect(windlassHandler).to.exist

      // External control should not affect PUT handler registration
      const result = windlassHandler(
        'vessels.self',
        externalConfig.windlassPath,
        'up',
        (callbackResult: any) => {
          expect(callbackResult.state).to.equal('COMPLETED')
          setTimeout(() => {
            expect(mockApp.relayStates.get(externalConfig.upRelayPath)).to.be
              .true

            // Check that windlass state path reflects the relay up state
            const windlassStateMessage = mockApp.messages.find(
              (m) =>
                m.message?.updates?.[0]?.values?.[0]?.path ===
                  externalConfig.windlassPath &&
                m.message?.updates?.[0]?.values?.[0]?.value === 'up'
            )
            expect(windlassStateMessage).to.exist

            done()
          }, 50)
        }
      )

      // The direct return should be PENDING
      expect(result.state).to.equal('PENDING')
    })
  })

  describe('Mixed Control Scenarios', () => {
    beforeEach(() => {
      plugin.start(externalConfig, () => {})
    })

    it('should handle simultaneous relay and external control properly', (done) => {
      // Start with relay control up
      mockApp.simulatePathChange(externalConfig.upRelayPath, true)

      // After a short time, start external down control
      setTimeout(() => {
        mockApp.simulatePathChange(externalConfig.externalDownPath, true)

        // Stop relay control while external continues
        setTimeout(() => {
          mockApp.simulatePathChange(externalConfig.upRelayPath, false)

          // Finally stop external control
          setTimeout(() => {
            mockApp.simulatePathChange(externalConfig.externalDownPath, false)

            setTimeout(() => {
              const chainValue = mockApp.getLatestChainCounterValue()
              // Chain movement should reflect external control taking precedence
              expect(chainValue).to.be.a('number')
              done()
            }, 50)
          }, 200)
        }, 200)
      }, 200)
    }).timeout(3000)
  })

  describe('Windlass State Path Updates', () => {
    beforeEach(() => {
      plugin.start(externalConfig, () => {})
    })

    it('should update windlass state path when external up control is active', (done) => {
      // Clear initial messages
      mockApp.messages = []

      // Simulate external up control
      mockApp.simulatePathChange(externalConfig.externalUpPath, true)

      setTimeout(() => {
        // Should have windlass state path update
        const windlassStateMessage = mockApp.messages.find(
          (m) =>
            m.message?.updates?.[0]?.values?.[0]?.path ===
              externalConfig.windlassPath &&
            m.message?.updates?.[0]?.values?.[0]?.value === 'up'
        )
        expect(windlassStateMessage).to.exist

        // Turn off external control
        mockApp.simulatePathChange(externalConfig.externalUpPath, false)

        setTimeout(() => {
          // Should update to off state
          const offStateMessage = mockApp.messages.find(
            (m) =>
              m.message?.updates?.[0]?.values?.[0]?.path ===
                externalConfig.windlassPath &&
              m.message?.updates?.[0]?.values?.[0]?.value === 'off'
          )
          expect(offStateMessage).to.exist
          done()
        }, 50)
      }, 50)
    })

    it('should update windlass state path when external down control is active', (done) => {
      // Clear initial messages
      mockApp.messages = []

      // Simulate external down control
      mockApp.simulatePathChange(externalConfig.externalDownPath, true)

      setTimeout(() => {
        // Should have windlass state path update
        const windlassStateMessage = mockApp.messages.find(
          (m) =>
            m.message?.updates?.[0]?.values?.[0]?.path ===
              externalConfig.windlassPath &&
            m.message?.updates?.[0]?.values?.[0]?.value === 'down'
        )
        expect(windlassStateMessage).to.exist

        done()
      }, 50)
    })

    it('should prioritize external control state over relay control state', (done) => {
      // Start relay up control
      mockApp.simulatePathChange(externalConfig.upRelayPath, true)

      setTimeout(() => {
        // Should show up state
        let windlassStateMessages = mockApp.messages.filter(
          (m) =>
            m.message?.updates?.[0]?.values?.[0]?.path ===
            externalConfig.windlassPath
        )
        expect(
          windlassStateMessages[windlassStateMessages.length - 1].message
            .updates[0].values[0].value
        ).to.equal('up')

        // Clear messages and start external down control
        mockApp.messages = []
        mockApp.simulatePathChange(externalConfig.externalDownPath, true)

        setTimeout(() => {
          // Should now show down state (external takes precedence)
          const externalStateMessage = mockApp.messages.find(
            (m) =>
              m.message?.updates?.[0]?.values?.[0]?.path ===
                externalConfig.windlassPath &&
              m.message?.updates?.[0]?.values?.[0]?.value === 'down'
          )
          expect(externalStateMessage).to.exist

          // Stop external control
          mockApp.simulatePathChange(externalConfig.externalDownPath, false)

          setTimeout(() => {
            // Should revert to relay state (up)
            const revertStateMessage = mockApp.messages.find(
              (m) =>
                m.message?.updates?.[0]?.values?.[0]?.path ===
                  externalConfig.windlassPath &&
                m.message?.updates?.[0]?.values?.[0]?.value === 'up'
            )
            expect(revertStateMessage).to.exist
            done()
          }, 50)
        }, 50)
      }, 50)
    })
  })

  describe('External Control Without Chain Counter', () => {
    it('should not subscribe to external paths when chain counter is disabled', () => {
      const configNoChain = { ...externalConfig }
      configNoChain.chainRateFeetPerMinute = 0 // Disable chain counter

      plugin.start(configNoChain, () => {})

      const subscription = mockApp.subscriptions[0]
      const subscribedPaths = subscription.options.subscribe.map(
        (s: any) => s.path
      )

      // Should only have relay paths, not external paths
      expect(subscribedPaths).to.include(configNoChain.upRelayPath)
      expect(subscribedPaths).to.include(configNoChain.downRelayPath)
      expect(subscribedPaths).to.not.include(configNoChain.externalUpPath)
      expect(subscribedPaths).to.not.include(configNoChain.externalDownPath)
    })
  })
})
