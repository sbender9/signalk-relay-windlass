import { expect } from 'chai'
import { describe, it, beforeEach, afterEach } from 'mocha'
import windlassPlugin from '../src/index'

// Mock Signal K Server API
class MockServerAPI {
  public messages: any[] = []
  public subscriptions: any[] = []
  public putHandlers: Map<string, Function> = new Map()
  public relayStates: Map<string, boolean> = new Map()

  debug(message: string) {
    // console.log(`[DEBUG] ${message}`)
  }

  error(message: string) {
    console.error(`[ERROR] ${message}`)
  }

  handleMessage(pluginId: string, message: any) {
    this.messages.push({ pluginId, message })
  }

  subscriptionmanager = {
    subscribe: (options: any, onStop: any[], errorCallback: Function, deltaCallback: Function) => {
      this.subscriptions.push({ options, onStop, errorCallback, deltaCallback })
      return { unsubscribe: () => {} }
    }
  }

  registerPutHandler(context: string, path: string, handler: Function) {
    this.putHandlers.set(path, handler)
  }

  putSelfPath(path: string, value: any, callback?: Function) {
    this.relayStates.set(path, value)
    if (callback) {
      callback({ state: 'COMPLETED', statusCode: 200 })
    }
  }

  // Helper method to simulate relay state changes
  simulateRelayChange(path: string, value: boolean) {
    const subscription = this.subscriptions[0]
    if (subscription && subscription.deltaCallback) {
      subscription.deltaCallback({
        updates: [{
          values: [{
            path: path,
            value: value
          }]
        }]
      })
    }
  }

  // Helper method to get latest message of specific type
  getLatestMessage(pathPattern: RegExp) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]
      const updates = message.message?.updates || []
      for (const update of updates) {
        const values = update.values || []
        const metas = update.meta || []
        for (const value of values) {
          if (pathPattern.test(value.path)) {
            return value
          }
        }
        for (const meta of metas) {
          if (pathPattern.test(meta.path)) {
            return meta
          }
        }
      }
    }
    return null
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

describe('Windlass Plugin', () => {
  let mockApp: MockServerAPI
  let plugin: any
  let windlassConfig: any

  beforeEach(() => {
    mockApp = new MockServerAPI()
    windlassConfig = {
      windlassPath: 'electrical.windlass.control.state',
      upRelayPath: 'electrical.windlass.up.state',
      downRelayPath: 'electrical.windlass.down.state',
      timeoutSeconds: 30,
      switchingDelaySeconds: 2,
      chainRateFeetPerMinute: 60,
      chainCounterPath: 'navigation.anchor.chainOut',
      chainCounterResetPath: 'navigation.anchor.chainOut.reset'
    }
    plugin = windlassPlugin(mockApp)
  })

  afterEach(() => {
    if (plugin && plugin.stop) {
      plugin.stop()
    }
    mockApp.reset()
  })

  describe('Plugin Initialization', () => {
    it('should have correct plugin metadata', () => {
      expect(plugin.id).to.equal('signalk-relay-windlass')
      expect(plugin.name).to.equal('Signal K Relay Windlass')
      expect(plugin.description).to.include('windlass using two relay switches')
    })

    it('should have required configuration schema', () => {
      expect(plugin.schema).to.exist
      expect(plugin.schema.properties).to.exist
      expect(plugin.schema.properties.windlassPath).to.exist
      expect(plugin.schema.properties.upRelayPath).to.exist
      expect(plugin.schema.properties.downRelayPath).to.exist
      expect(plugin.schema.properties.timeoutSeconds).to.exist
      expect(plugin.schema.properties.chainRateFeetPerMinute).to.exist
    })

    it('should have required configuration paths in schema', () => {
      expect(plugin.schema.required).to.include('windlassPath')
      expect(plugin.schema.required).to.include('upRelayPath')
      expect(plugin.schema.required).to.include('downRelayPath')
    })
  })

  describe('Plugin Start and Stop', () => {
    it('should start without errors', () => {
      expect(() => plugin.start(windlassConfig, () => {})).to.not.throw()
    })

    it('should register subscriptions for relay monitoring', () => {
      plugin.start(windlassConfig, () => {})
      expect(mockApp.subscriptions).to.have.length(1)
      
      const subscription = mockApp.subscriptions[0]
      expect(subscription.options.subscribe).to.have.length(2)
      expect(subscription.options.subscribe[0].path).to.equal(windlassConfig.upRelayPath)
      expect(subscription.options.subscribe[1].path).to.equal(windlassConfig.downRelayPath)
    })

    it('should register PUT handlers', () => {
      plugin.start(windlassConfig, () => {})
      expect(mockApp.putHandlers.has(windlassConfig.windlassPath)).to.be.true
      expect(mockApp.putHandlers.has(windlassConfig.chainCounterResetPath)).to.be.true
    })

    it('should send initial windlass state', () => {
      plugin.start(windlassConfig, () => {})
      const stateMessage = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
      expect(stateMessage).to.exist
      expect(stateMessage.value).to.equal('off')
    })
  })

  describe('Windlass State Management', () => {
    beforeEach(() => {
      plugin.start(windlassConfig, () => {})
    })

    it('should detect up state when up relay is on', (done) => {
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      
      setTimeout(() => {
        const stateMessage = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
        expect(stateMessage.value).to.equal('up')
        done()
      }, 10)
    })

    it('should detect down state when down relay is on', (done) => {
      mockApp.simulateRelayChange(windlassConfig.downRelayPath, true)
      
      setTimeout(() => {
        const stateMessage = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
        expect(stateMessage.value).to.equal('down')
        done()
      }, 10)
    })

    it('should detect off state when both relays are off', (done) => {
      // First set up state
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      
      setTimeout(() => {
        // Then turn off
        mockApp.simulateRelayChange(windlassConfig.upRelayPath, false)
        
        setTimeout(() => {
          const stateMessage = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
          expect(stateMessage.value).to.equal('off')
          done()
        }, 10)
      }, 10)
    })

    it('should prioritize off state when both relays are on', (done) => {
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      mockApp.simulateRelayChange(windlassConfig.downRelayPath, true)
      
      setTimeout(() => {
        const stateMessage = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
        expect(stateMessage.value).to.equal('off')
        done()
      }, 10)
    })
  })

  describe('PUT Handler Commands', () => {
    beforeEach(() => {
      plugin.start(windlassConfig, () => {})
    })

    it('should handle windlass up command', (done) => {
      const handler = mockApp.putHandlers.get(windlassConfig.windlassPath)
      expect(handler).to.exist
      
      handler('vessels.self', windlassConfig.windlassPath, 'up', (result: any) => {
        expect(result.state).to.equal('COMPLETED')
        expect(result.statusCode).to.equal(200)
        
        // Check that relays are set correctly
        expect(mockApp.relayStates.get(windlassConfig.downRelayPath)).to.be.false
        expect(mockApp.relayStates.get(windlassConfig.upRelayPath)).to.be.true
        done()
      })
    })

    it('should handle windlass down command', (done) => {
      const handler = mockApp.putHandlers.get(windlassConfig.windlassPath)
      
      handler('vessels.self', windlassConfig.windlassPath, 'down', (result: any) => {
        expect(result.state).to.equal('COMPLETED')
        expect(result.statusCode).to.equal(200)
        
        // Check that relays are set correctly
        expect(mockApp.relayStates.get(windlassConfig.upRelayPath)).to.be.false
        expect(mockApp.relayStates.get(windlassConfig.downRelayPath)).to.be.true
        done()
      })
    })

    it('should handle windlass off command', (done) => {
      const handler = mockApp.putHandlers.get(windlassConfig.windlassPath)
      
      handler('vessels.self', windlassConfig.windlassPath, 'off', (result: any) => {
        expect(result.state).to.equal('COMPLETED')
        expect(result.statusCode).to.equal(200)
        
        // Check that both relays are off
        expect(mockApp.relayStates.get(windlassConfig.upRelayPath)).to.be.false
        expect(mockApp.relayStates.get(windlassConfig.downRelayPath)).to.be.false
        done()
      })
    })

    it('should reject invalid commands', () => {
      const handler = mockApp.putHandlers.get(windlassConfig.windlassPath)
      
      const result = handler('vessels.self', windlassConfig.windlassPath, 'invalid', () => {})
      expect(result.state).to.equal('COMPLETED')
      expect(result.statusCode).to.equal(500)
    })
  })

  describe('Chain Counter', () => {
    beforeEach(() => {
      plugin.start(windlassConfig, () => {})
    })

    it('should send initial chain counter value', () => {
      const chainValue = mockApp.getLatestChainCounterValue()
      expect(chainValue).to.exist
      expect(chainValue).to.equal(0)
    })

    it('should register chain counter reset handler', () => {
      expect(mockApp.putHandlers.has(windlassConfig.chainCounterResetPath)).to.be.true
    })

    it('should reset chain counter on PUT command', (done) => {
      const handler = mockApp.putHandlers.get(windlassConfig.chainCounterResetPath)
      
      handler('vessels.self', windlassConfig.chainCounterResetPath, true, (result: any) => {
        expect(result.state).to.equal('COMPLETED')
        expect(result.statusCode).to.equal(200)
        
        setTimeout(() => {
          const chainValue = mockApp.getLatestChainCounterValue()
          expect(chainValue).to.equal(0)
          done()
        }, 10)
      })
    })

    it('should reject invalid reset values', () => {
      const handler = mockApp.putHandlers.get(windlassConfig.chainCounterResetPath)
      
      const result = handler('vessels.self', windlassConfig.chainCounterResetPath, 'invalid', () => {})
      expect(result.state).to.equal('COMPLETED')
      expect(result.statusCode).to.equal(500)
    })
  })

  describe('Chain Counter Updates', () => {
    beforeEach(() => {
      plugin.start(windlassConfig, () => {})
    })

    it('should update chain counter when windlass goes down', (done) => {
      // Start with windlass going down
      mockApp.simulateRelayChange(windlassConfig.downRelayPath, true)
      
      // Wait to simulate some operation time
      setTimeout(() => {
        // Stop windlass
        mockApp.simulateRelayChange(windlassConfig.downRelayPath, false)
        
        setTimeout(() => {
          const chainValue = mockApp.getLatestChainCounterValue()
          expect(chainValue).to.exist
          // Should have some chain out (converted from feet to meters)
          expect(chainValue).to.be.greaterThan(0)
          done()
        }, 10)
      }, 100) // Wait 100ms to simulate operation time
    })

    it('should not update chain counter when disabled', () => {
      plugin.stop()
      
      const disabledConfig = { ...windlassConfig, chainRateFeetPerMinute: 0 }
      plugin.start(disabledConfig, () => {})
      
      mockApp.simulateRelayChange(windlassConfig.downRelayPath, true)
      
      // Chain counter should remain 0 since it's disabled
      const chainValue = mockApp.getLatestChainCounterValue()
      expect(chainValue).to.equal(0)
    })
  })

  describe('Safety Timeout', () => {
    beforeEach(() => {
      windlassConfig.timeoutSeconds = 1 // Very short timeout for testing
      plugin.start(windlassConfig, () => {})
    })

    it('should trigger timeout notification after configured time', (done) => {
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      
      setTimeout(() => {
        const notifications = mockApp.messages.filter(m => 
          m.message.updates?.[0]?.values?.[0]?.path === 'notifications.windlass.timeout'
        )
        expect(notifications).to.have.length.greaterThan(0)
        
        const notification = notifications[notifications.length - 1]
        expect(notification.message.updates[0].values[0].value.state).to.equal('alert')
        done()
      }, 1100) // Wait for timeout + buffer
    }).timeout(2000)

    it('should force windlass off on timeout', (done) => {
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      
      setTimeout(() => {
        expect(mockApp.relayStates.get(windlassConfig.upRelayPath)).to.be.false
        expect(mockApp.relayStates.get(windlassConfig.downRelayPath)).to.be.false
        done()
      }, 1100)
    }).timeout(2000)
  })

  describe('Notification Auto-Clear', () => {
    beforeEach(() => {
      windlassConfig.timeoutSeconds = 1
      plugin.start(windlassConfig, () => {})
    })

    it('should clear timeout notification after 10 seconds', (done) => {
      mockApp.simulateRelayChange(windlassConfig.upRelayPath, true)
      
      // Wait for timeout to trigger
      setTimeout(() => {
        const initialNotifications = mockApp.messages.filter(m => 
          m.message?.updates?.[0]?.values?.[0]?.path === 'notifications.windlass.timeout'
        )
        expect(initialNotifications.length).to.be.greaterThan(0)
        
        // Wait for auto-clear (need to wait full 10 seconds)
        setTimeout(() => {
          const allNotifications = mockApp.messages.filter(m => 
            m.message?.updates?.[0]?.values?.[0]?.path === 'notifications.windlass.timeout'
          )
          
          // Should have at least 2: alert and normal
          expect(allNotifications.length).to.be.greaterThan(1)
          
          const lastNotification = allNotifications[allNotifications.length - 1]
          expect(lastNotification.message.updates[0].values[0].value.state).to.equal('normal')
          done()
        }, 10100) // Wait slightly longer than 10 seconds
      }, 1100)
    }).timeout(15000) // Increase test timeout
  })

  describe('Metadata Registration', () => {
    beforeEach(() => {
      plugin.start(windlassConfig, () => {})
    })

    it('should register windlass control metadata', () => {
      const windlassMetadata = mockApp.getLatestMessage(/electrical\.windlass\.control\.state/)
      expect(windlassMetadata).to.exist
    })

    it('should register chain counter metadata', () => {
      const chainMetadata = mockApp.getLatestMessage(/navigation\.anchor\.chainOut/)
      expect(chainMetadata).to.exist
    })

    it('should register chain reset metadata', () => {
      const resetMetadata = mockApp.getLatestMessage(/navigation\.anchor\.chainOut\.reset/)
      expect(resetMetadata).to.exist
    })
  })
})