# SignalK Relay Windlass Plugin

A Signal K server plugin that provides safe control of an electric windlass (anchor winch) using two relay switches. This plugin allows you to raise and lower your anchor through Signal K while providing important safety features like automatic timeout protection.

## Features

- **Dual Relay Control**: Controls windlass up/down operation using separate relays
- **Safety Timeout**: Configurable automatic shutoff in case of network/swithing failure
- **Direction Switch Delay**: Prevents rapid direction changes that could damage windlass
- **Chain Counter**: Automatic tracking of chain deployment based on operation time and configurable rate
- **External Control Integration**: Monitor external windlass controls with automatic state and chain tracking
- **Real-time Status**: Live monitoring of windlass state based on relay and external control feedback
- **Notification System**: Alert notifications when safety timeout is triggered
- **PUT Handler**: Control windlass through Signal K PUT requests

### Settings

- **Windlass State Path**: Signal K path for windlass control state (default: `electrical.windlass.control.state`)
- **Up Relay Path**: Path to relay that controls windlass up operation (default: `electrical.windlass.up.state`)
- **Down Relay Path**: Path to relay that controls windlass down operation (default: `electrical.windlass.down.state`)
- **Safety Timeout**: Maximum continuous operation time in seconds (default: 30, range: 0-300, 0 = disabled)
- **Direction Switch Delay**: Minimum delay when switching between up and down directions in seconds (default: 2, range: 0-30, 0 = disabled)
- **Chain Rate**: Rate at which chain is deployed/retrieved in feet per minute (default: 60, range: 0-500, 0 = disable chain counter)
- **Chain Counter Path**: Signal K path for chain out counter in feet (default: `navigation.anchor.chainOut`)
- **Chain Counter Reset Path**: Signal K path for chain counter reset command (default: `electrical.windlass.chainCounterReset.state`)
- **External Up Path**: Optional Signal K path for external windlass up control monitoring (used for chain counter tracking and state reporting)
- **External Down Path**: Optional Signal K path for external windlass down control monitoring (used for chain counter tracking and state reporting)

## Usage

### Control Methods

The windlass can be controlled through several methods:

1. **PUT Requests**: Send HTTP PUT requests to the windlass path
2. **WebSocket**: Send delta messages via WebSocket
3. **Node-RED**: Use Signal K nodes in Node-RED flows

### Control Values

- `"up"` - Raise the anchor (activates up relay, deactivates down relay)
- `"down"` - Lower the anchor (activates down relay, deactivates up relay)
- `"off"` - Stop operation (deactivates both relays)

### Chain Counter Reset

The chain counter can be reset to zero using a PUT request:

```bash
curl -X PUT -H "Content-Type: application/json" \\
  -d '{"value": true}' \\
  http://your-signalk-server:3000/signalk/v1/api/vessels/self/navigation/anchor/chainCounterReset/state
```

### External Control Monitoring

The plugin can monitor external windlass controls (such as NMEA 2000 data or other control systems) for both chain counter tracking and windlass state reporting. When external control paths are configured:

- The plugin subscribes to the specified external control paths
- Chain counter tracking works with both internal relay control and external control
- **Windlass state path updates**: The configured windlass state path will reflect external control states
- External control takes precedence over relay control for both chain counter and state reporting
- When external control is active, the windlass state path shows the external state
- When external control is inactive, the windlass state path shows the relay state
- External control does not affect the relay-based windlass PUT handler operations
- External control is only active when chain counter is enabled (chain rate > 0)

This feature is useful when:
- Your windlass is controlled by multiple systems (relay plugin + external system)
- You want to track chain deployment from NMEA 2000 windlass data
- You need chain counter tracking even when the windlass is operated manually or by other systems
- You want unified windlass state reporting regardless of which system is controlling the windlass
- You're integrating with existing windlass control systems while adding chain tracking and state monitoring


**State Priority Logic:**
- If external up control is active → windlass state path shows "up"
- If external down control is active → windlass state path shows "down"  
- If external control is off but relay up is active → windlass state path shows "up"
- If external control is off but relay down is active → windlass state path shows "down"
- If both external and relay controls are off → windlass state path shows "off"

### PUT Request Example

```bash
curl -X PUT \
  http://localhost:3000/signalk/v1/api/vessels/self/electrical/windlass/control/state \
  -H 'Content-Type: application/json' \
  -d '{"value": "up"}'
```

## Safety Features

### Automatic Timeout Protection

The plugin includes configurable timeout protection:

- **Configurable Duration**: Set maximum run time (0-300 seconds)
- **Automatic Shutoff**: Both relays automatically deactivated when timeout reached
- **Visual/Audio Alerts**: Notifications sent through Signal K alert system
- **Auto-Clear Alerts**: Timeout notifications automatically reset to normal after 10 seconds

### Direction Switch Delay Protection

To prevent motor and gearbox damage from rapid direction changes:

- **Configurable Delay**: Set minimum time between opposite direction commands (0-30 seconds)
- **Smart Timing**: Only applies when switching from up→down or down→up
- **Immediate Stop**: Off commands execute immediately for safety
- **Queue Management**: Direction changes are delayed and automatically executed when safe

### Chain Counter

Automatic tracking of chain deployment based on windlass operation time:

- **Configurable Rate**: Set chain deployment rate in feet per minute (0-500)
- **Real-time Tracking**: Updates chain out counter while windlass operates
- **Active State Updates**: Sends chain counter value to Signal K every second only when windlass is in up or down state
- **Accurate Calculation**: Based on actual operation time and configured rate
- **Reset Function**: PUT handler to reset chain counter to zero
- **Signal K Output**: Chain out value available at configurable path (in meters)

### State Monitoring

- **Real-time Feedback**: Windlass state automatically updates based on relay positions
- **Conflict Detection**: System detects invalid relay combinations
- **Subscription-based**: Uses Signal K subscriptions for efficient monitoring

## Signal K Paths

### Output Paths

| Path                                | Description            | Values                    |
| ----------------------------------- | ---------------------- | ------------------------- |
| `electrical.windlass.control.state` | Current windlass state | `"up"`, `"down"`, `"off"` |
| `navigation.anchor.chainOut`        | Chain out in feet      | Number (feet)             |

### Input Paths (Monitored)

| Path                             | Description      | Values                      |
| -------------------------------- | ---------------- | --------------------------- |
| `electrical.windlass.up.state`   | Up relay state   | `true` (on) / `false` (off) |
| `electrical.windlass.down.state` | Down relay state | `true` (on) / `false` (off) |

### Notification Paths

| Path                             | Description                 |
| -------------------------------- | --------------------------- |
| `notifications.windlass.timeout` | Timeout alert notifications |

## License

Licensed under the Apache License 2.0. See LICENSE file for details.

## Contributing

Issues and pull requests welcome! Please ensure:

- Code follows existing style (run `npm run format`)
- Tests pass (`npm test`)
- Documentation is updated for new features

## Author

Scott Bender <scott@scottbender.net>
